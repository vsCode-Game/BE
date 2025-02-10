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
  async findUserById(userId: number): Promise<User | null> {
    return this.userRepository.findOne({ where: { id: userId } }) || null;
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
      wins: 0,
    });
    return this.userRepository.save(newUser);
  }

  async validateUser(userEmail: string, pass: string): Promise<User | null> {
    const user = await this.findEmailDplct(userEmail);
    if (user && (await bcrypt.compare(pass, user.password))) {
      return user;
    }
    return null;
  }

  async recordWin(userId: number, roomId: number): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (user) {
      user.wins += 1; // 유저 엔티티에 'wins' 필드가 있다고 가정
      // 필요 시 게임 방 ID와 연관된 다른 정보도 저장할 수 있습니다.
      await this.userRepository.save(user);
    }
  }
}
