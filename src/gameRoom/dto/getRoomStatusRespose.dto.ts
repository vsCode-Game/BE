// dto/getRoomStatusResponse.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { GameRoomDto } from './gameRoom.dto';
import { GameRoomUserDto } from './gameRoomUser.dto';

export class GetRoomStatusResponseDto {
  @ApiProperty({ type: GameRoomDto })
  roomName: GameRoomDto;

  @ApiProperty({ type: [GameRoomUserDto] })
  users: GameRoomUserDto[];
}
