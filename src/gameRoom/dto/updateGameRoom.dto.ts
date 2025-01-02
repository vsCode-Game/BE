import { PartialType } from '@nestjs/mapped-types';
import { CreateGameRoomDto } from './createGameRoom.dto';

export class UpdateGameRoomDto extends PartialType(CreateGameRoomDto) {}
