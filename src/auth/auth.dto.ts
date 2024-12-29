import { IsString, IsEmail, Matches, IsNotEmpty } from 'class-validator';

export default class LoginUserDto {
  @IsEmail({}, { message: '이메일 형식이 틀렸습니다.' })
  @IsNotEmpty()
  userEmail: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message:
      '비밀번호는 알파벳, 숫자, 특수문자를 포함하여 8글자 이상 작성해주세요',
  })
  readonly password: string;
}
