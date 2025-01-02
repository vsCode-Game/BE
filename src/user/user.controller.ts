import { Body, Controller, Post, BadRequestException } from '@nestjs/common';
import { UserService } from './user.service';
import SingupUserDto from './dto/user.dto';
import { validateOrReject } from 'class-validator';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('signup')
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

  @Post('email/check') async checkEmail(
    @Body('userEmail') userEmail: string,
  ): Promise<{ available: boolean }> {
    try {
      const dto = new SingupUserDto();
      dto.userEmail = userEmail;
      await validateOrReject(dto);

      const existingUser = await this.userService.findEmailDplct(userEmail);
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
