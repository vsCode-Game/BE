import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, Matches, IsNotEmpty } from 'class-validator';

export default class SingupUserDto {
  @ApiProperty({
    required: true,
    example: 'example@email.com',
    description: '이메일',
  })
  @IsEmail({}, { message: '이메일 형식이 틀렸습니다.' })
  @IsNotEmpty()
  userEmail: string;

  @ApiProperty({
    required: true,
    example: 'example nickname',
    description: '닉네임',
  })
  @IsString()
  @IsNotEmpty()
  userNickname: string;

  @ApiProperty({
    required: true,
    example: 'teST11!!',
    description: '비밀번호',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/, {
    message:
      '비밀번호는 알파벳, 숫자, 특수문자를 포함하여 8글자 이상 작성해주세요',
  })
  readonly password: string;
}
