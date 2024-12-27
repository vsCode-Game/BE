import { IsString, IsEmail, Matches } from 'class-validator';

export default class SingupUserDto {
  @IsEmail({}, { message: 'Invalid email format' })
  readonly userEmail: string;

  @IsString()
  readonly userNickname: string;

  @IsString()
  @Matches(
    /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/,
    { message: 'Password too weak' },
  )
  readonly password: string;
}
