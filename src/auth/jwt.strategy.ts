import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly redisService: RedisService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET, // 환경변수로 관리
    });
  }

  async validate(payload: any) {
    const { userEmail, userId, exp } = payload;

    if (!userEmail || !userId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // Redis에서 토큰 확인
    const storedToken = await this.redisService.get(`access:${userEmail}`);
    if (!storedToken) {
      throw new UnauthorizedException('Token not found in Redis');
    }

    // 만료 시간 확인
    const currentTime = Math.floor(Date.now() / 1000);
    if (exp && currentTime > exp) {
      throw new UnauthorizedException('Token has expired');
    }

    // 유효한 유저 정보 반환
    return { userEmail, userId };
  }
}
