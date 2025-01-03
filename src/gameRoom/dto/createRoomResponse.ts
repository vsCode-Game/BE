import { ApiProperty } from '@nestjs/swagger';
import { GameRoomDto } from './gameRoom.dto';
import { GameRoomUserDto } from './gameRoomUser.dto';

export class CreateRoomResponseDto {
  @ApiProperty({ type: GameRoomDto })
  room: GameRoomDto;

  @ApiProperty({ type: GameRoomUserDto })
  user: GameRoomUserDto;
}
