// auth.controller.ts

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
import { Response, Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import LoginUserDto from './dto/auth.dto';
import { RedisAuthGuard } from './auth.guard';
import { RedisService } from 'src/redis/redis.service';

import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  @Post('login')
  @ApiOperation({
    summary: '로그인',
    description: '이메일, 패스워드를 이용한 로그인',
  })
  @ApiResponse({
    status: 200,
    description:
      '로그인 성공 시 Access Token(헤더), Refresh Token(쿠키)을 발급합니다.',
    schema: {
      example: {
        accessToken: 'Bearer <JWT_TOKEN_HERE>',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: '이메일 또는 비밀번호가 잘못된 경우',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid credentials',
      },
    },
  })
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

    const payload = { userEmail: user.userEmail, userId: user.id };
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
      secure: true, // HTTPS에서만 동작 (개발시엔 false로 설정)
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
    });

    return {
      accessToken: `Bearer ${this.jwtService.sign(payload)}`,
    };
  }

  @UseGuards(RedisAuthGuard)
  @Get('profile')
  @ApiOperation({
    summary: '프로필 조회(Protected)',
    description: '로그인이 필요한 프로필 조회 API',
  })
  @ApiBearerAuth() // Swagger에서 Bearer Token 헤더를 입력할 수 있도록 표시
  @ApiResponse({
    status: 200,
    description: '정상적으로 접근한 경우',
    schema: {
      example: {
        message: 'This is a protected route',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: '권한이 없거나 토큰이 만료된 경우',
    schema: {
      example: {
        statusCode: 401,
        message: 'Unauthorized',
      },
    },
  })
  getProfile() {
    return { message: 'This is a protected route' };
  }

  @Post('refresh')
  @ApiOperation({
    summary: 'Access Token 갱신',
    description: 'Refresh Token을 통해 새로운 Access Token을 발급받습니다.',
  })
  @ApiResponse({
    status: 200,
    description: '새로운 Access Token을 발급합니다.',
    schema: {
      example: {
        accessToken: 'Bearer <NEW_ACCESS_TOKEN>',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh Token이 없거나 올바르지 않은 경우',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid refresh token',
      },
    },
  })
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
