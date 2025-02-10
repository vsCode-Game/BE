import { PickType } from '@nestjs/swagger';
import SingupUserDto from './user.dto';

export class CheckEmailDto extends PickType(SingupUserDto, [
  'userEmail',
] as const) {}
