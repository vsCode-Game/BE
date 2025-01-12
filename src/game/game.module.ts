import { Module } from '@nestjs/common';
import { GameGateway } from './game.gateway';
import { GameRoomModule } from '../gameRoom/gameRoom.module';
import { GameService } from './game.service';
import { RedisModule } from 'src/redis/redis.module';
// import { RedisService } from 'src/redis/redis.service';

@Module({
  imports: [GameRoomModule, RedisModule],
  providers: [GameGateway, GameService],
})
export class GameModule {}
