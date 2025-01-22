import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GameRoomController } from './gameRoom.controller';
import { GameRoomService } from './gameRoom.service';
import { GameRoom } from './entities/gameRoom.entity';
import { GameRoomUser } from './entities/gameRoomUser.entity';
import { RedisModule } from 'src/redis/redis.module'; // RedisModule 추가
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GameRoom, GameRoomUser]),
    RedisModule, // RedisModule 가져오기
    UserModule,
  ],
  controllers: [GameRoomController],
  providers: [GameRoomService],
  exports: [GameRoomService],
})
export class GameRoomModule {}
