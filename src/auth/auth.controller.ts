import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
  Get,
} from '@nestjs/common';
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
  async login(@Body() loginDto: LoginUserDto) {
    const user = await this.userService.validateUser(
      loginDto.userEmail,
      loginDto.password,
    );
    if (!user) {
      throw new HttpException('Invalid credentials', HttpStatus.UNAUTHORIZED);
    }

    const payload = { userEmail: user.userEmail, sub: user.id };
    const accessToken = this.jwtService.sign(payload);
    await this.redisService.set(user.userEmail, accessToken, 3600);

    return {
      accessToken: `Bearer ${this.jwtService.sign(payload)}`,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile() {
    return { message: 'This is a protected route' };
  }
}
