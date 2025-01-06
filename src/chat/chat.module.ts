import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { GameRoomModule } from '../gameRoom/gameRoom.module';

@Module({
  imports: [GameRoomModule],
  providers: [ChatGateway],
})
export class ChatModule {}
