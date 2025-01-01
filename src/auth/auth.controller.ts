import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
  Get,
  Res,
  Req,
} from '@nestjs/common';
import { Response } from 'express';
import { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import LoginUserDto from './auth.dto';
import { JwtAuthGuard } from './auth.guard';
import { RedisService } from 'src/redis/redis.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  @Post('login')
  async login(
    @Body() loginDto: LoginUserDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.userService.validateUser(
      loginDto.userEmail,
      loginDto.password,
    );
    if (!user) {
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    const payload = { userEmail: user.userEmail, sub: user.id };
    const accessToken = this.jwtService.sign(payload, { expiresIn: '2h' });
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' });
    await this.redisService.set(`access:${user.userEmail}`, accessToken, 3600);
    await this.redisService.set(
      `refresh:${user.userEmail}`,
      refreshToken,
      7 * 24 * 60 * 60,
    );

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true, // JavaScript로 접근 불가
      secure: true, // HTTPS에서만 동작 (로컬 개발 시 false로 설정)
      sameSite: 'none', // 일반 로그인
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
    });

    return {
      accessToken: `Bearer ${this.jwtService.sign(payload)}`,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile() {
    return { message: 'This is a protected route' };
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies['refreshToken']; // 쿠키에서 RefreshToken 읽기

    if (!refreshToken) {
      throw new HttpException(
        'Refresh token not found',
        HttpStatus.UNAUTHORIZED,
      );
    }

    try {
      // RefreshToken 검증
      const payload = this.jwtService.verify(refreshToken);

      // Redis에서 RefreshToken 확인
      const storedRefreshToken = await this.redisService.get(
        `refresh:${payload.userEmail}`,
      );

      if (!storedRefreshToken || storedRefreshToken !== refreshToken) {
        throw new HttpException(
          'Invalid refresh token',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // 새로운 AccessToken 생성
      const newAccessToken = this.jwtService.sign(
        { userEmail: payload.userEmail, sub: payload.sub },
        { expiresIn: '15m' },
      );

      return {
        accessToken: `Bearer ${newAccessToken}`,
      };
    } catch (err) {
      throw new HttpException('Invalid refresh token', HttpStatus.UNAUTHORIZED);
    }
  }
}
