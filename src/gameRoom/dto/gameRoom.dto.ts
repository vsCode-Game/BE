
import { IsString, IsNotEmpty } from 'class-validator';

export class GameroomDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
