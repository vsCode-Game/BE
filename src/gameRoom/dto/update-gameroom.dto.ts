import { PartialType } from '@nestjs/mapped-types';
import { CreateGameroomDto } from './create-gameroom.dto';

export class UpdateGameroomDto extends PartialType(CreateGameroomDto) {}
