import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { GameRoomService } from './gameRoom.service';
import { RedisAuthGuard } from 'src/auth/auth.guard';

@Controller('gameRoom')
@UseGuards(RedisAuthGuard) // 컨트롤러 전체에 Guard 적용
export class GameRoomController {
  constructor(private readonly gameRoomService: GameRoomService) {}

  // 방 생성과 동시에 참가
  @Post('create')
  async createRoom(@Body() body: { roomName: string }, @Req() req: any) {
    const { roomName } = body;
    const userId = await req.user.userId; // JWT에서 추출한 userId 사용

    return await this.gameRoomService.createRoom(roomName, userId);
  }

  // 방 참가
  @Post('join/:roomId')
  async joinRoom(@Param('roomId') roomId: number, @Req() req: any) {
    const userId = req.user.userId; // JWT에서 추출한 userId 사용
    return await this.gameRoomService.joinRoom(roomId, userId);
  }

  // 방 나가기
  @Delete('leave/:roomId')
  async leaveRoom(@Param('roomId') roomId: number, @Req() req: any) {
    const userId = req.user.userId; // JWT에서 추출한 userId 사용
    return await this.gameRoomService.leaveRoom(roomId, userId);
  }

  // 방 상태 조회
  @Get(':roomId')
  async getRoomStatus(@Param('roomId') roomId: number) {
    return await this.gameRoomService.getRoomStatus(roomId);
  }
}
