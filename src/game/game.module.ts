import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameRoomModule } from '../gameRoom/gameRoom.module';
import { GameService } from './game.service';
import { RedisModule } from 'src/redis/redis.module';
import { UserModule } from 'src/user/user.module';
// import { RedisService } from 'src/redis/redis.service';

@Module({
  imports: [GameRoomModule, RedisModule, UserModule],
  providers: [GameGateway, GameService],
})
export class GameModule {}
