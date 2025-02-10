// dto/gameRoomUser.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsDate, IsString } from 'class-validator';

export class GameRoomUserDto {
  @ApiProperty({ example: 1, description: 'GameRoomUser 테이블 PK' })
  @IsNumber()
  id: number;

  @ApiProperty({ example: 10, description: '방 ID' })
  @IsNumber()
  roomId: number;

  @ApiProperty({ example: 100, description: '유저 ID' })
  @IsNumber()
  userId: number;

  @ApiProperty({ description: '방 참여 일시' })
  @IsDate()
  joinedAt: Date;
}
