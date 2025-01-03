import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class CreateGameRoomDto {
  @ApiProperty({
    example: 'My Awesome Room',
    description: '방 이름',
  })
  @IsString()
  @IsNotEmpty()
  roomName: string;
}
