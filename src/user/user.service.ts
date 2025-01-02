import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findEmailDplct(userEmail: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { userEmail } }) || null;
  }

  async findNicknameDplct(userNickname: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { userNickname } }) || null;
  }

  async create(
    userEmail: string,
    userNickname: string,
    password: string,
  ): Promise<User> {
    // 이메일 중복 확인
    const existingUser = await this.findEmailDplct(userEmail);
    if (existingUser) {
      throw new BadRequestException({
        status: 400,
        message: 'Email already in use',
      });
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

  async validateUser(userEmail: string, pass: string): Promise<User | null> {
    const user = await this.findEmailDplct(userEmail); // 이메일로 유저 검색
    if (user && (await bcrypt.compare(pass, user.password))) {
      return user; // 유저가 존재하고 비밀번호가 일치하면 유저 반환
    }
    return null; // 검증 실패
  }
}
