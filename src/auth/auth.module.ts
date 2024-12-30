import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UserService } from '../user/user.service';
import { User } from '../user/user.entity';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET, // 환경 변수로 관리 추천
      signOptions: { expiresIn: '1d' },
    }),
    RedisModule,
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, UserService],
})
export class AuthModule {}
