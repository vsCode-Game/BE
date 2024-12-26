import { Body, Controller, Post } from '@nestjs/common';
import { User } from './user.entity';
import { UserService } from './user.service';
import SingupUserDto from './user.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}
  @Post('signup')
  async signup(@Body() signupData: SingupUserDto): Promise<User> {
    this.userService.create(signupData.name, signupData.password);
    return;
  }
}
