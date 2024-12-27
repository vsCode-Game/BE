import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findEmailDplct(userEmail: string): Promise<User | undefined> {
    return this.userRepository.findOne({ where: { userEmail } });
  }

  async findNicknameDplct(userNickname: string): Promise<User | undefined> {
    return this.userRepository.findOne({ where: { userNickname } });
  }

  async createUser(
    userEmail: string,
    userNickname: string,
    password: string,
  ): Promise<User> {
    // 이메일 중복 확인
    const existingUser = await this.findEmailDplct(userEmail);
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = this.userRepository.create({
      userEmail,
      userNickname,
      password: hashedPassword,
    });
    return this.userRepository.save(newUser);
  }

  async validateUser(userNickname: string, pass: string): Promise<User | null> {
    const user = await this.findNicknameDplct(userNickname);
    if (user && (await bcrypt.compare(pass, user.password))) {
      return user;
    }
    return;
  }
}
