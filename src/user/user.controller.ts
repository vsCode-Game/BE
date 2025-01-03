import {
  Body,
  Controller,
  Post,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { UserService } from './user.service';
import SingupUserDto from './dto/user.dto';
import { validateOrReject } from 'class-validator';

import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CheckEmailDto } from './dto/checkEmail.dto';

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('signup')
  @ApiOperation({ summary: '회원 가입' })
  @ApiResponse({
    status: 201,
    description: '회원 가입 성공',
    schema: {
      example: {
        message: 'User created successfully',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '회원 가입 실패(중복/형식 오류)',
    schema: {
      example: {
        status: 400,
        message: 'Failed to create user',
      },
    },
  })
  async signup(
    @Body() signupData: SingupUserDto,
  ): Promise<{ message: string }> {
    try {
      await this.userService.create(
        signupData.userEmail,
        signupData.userNickname,
        signupData.password,
      );
      return { message: 'User created successfully' };
    } catch (error) {
      throw new BadRequestException({
        status: 400,
        message: error.response?.message || 'Failed to create user',
      });
    }
  }

  @Post('email/check')
  @HttpCode(200)
  @ApiOperation({ summary: '이메일 중복 체크' })
  @ApiResponse({
    status: 200,
    description: '이메일 중복 체크 결과 반환',
    schema: {
      example: {
        available: true,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: '이메일 형식 오류 또는 체크 실패',
    schema: {
      example: {
        status: 400,
        message: 'Invalid email format or failed to check email',
      },
    },
  })
  async checkEmail(
    @Body() checkEmailDto: CheckEmailDto,
  ): Promise<{ available: boolean }> {
    try {
      // validateOrReject로 DTO에 선언된 Validation 검사
      await validateOrReject(checkEmailDto);

      const existingUser = await this.userService.findEmailDplct(
        checkEmailDto.userEmail,
      );
      if (existingUser) {
        return { available: false };
      }
      return { available: true };
    } catch (error) {
      throw new BadRequestException({
        status: 400,
        message: 'Invalid email format or failed to check email',
      });
    }
  }
}
