import { IsString } from 'class-validator';

export default class SingupUserDto {
  @IsString()
  readonly name: string;

  @IsString()
  readonly password: string;
}
