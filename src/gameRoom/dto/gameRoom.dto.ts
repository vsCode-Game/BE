// dto/gameRoom.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsString, IsDate } from 'class-validator';

export class GameRoomDto {
  @ApiProperty({ example: 1, description: '게임 방 ID' })
  @IsNumber()
  id: number;

  @ApiProperty({ example: '테스트 방입니다.', description: '방 이름' })
  @IsString()
  roomName: string;

  @ApiProperty({ example: 2, description: '최대 인원 수' })
  @IsNumber()
  maxPlayers: number;

  @ApiProperty({ example: 1, description: '현재 인원 수' })
  @IsNumber()
  currentCount: number;

  @ApiProperty({ description: '방 생성 일시' })
  @IsDate()
  createdAt: Date;
}
