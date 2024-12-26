import { Injectable } from '@nestjs/common';
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

  async findOne(username: string): Promise<User | undefined> {
    return this.userRepository.findOne({ where: { username } });
  }

  async create(username: string, password: string): Promise<User> {
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = this.userRepository.create({
      username,
      password: hashedPassword,
    });
    return this.userRepository.save(newUser);
  }

  async validateUser(username: string, pass: string): Promise<User | null> {
    const user = await this.findOne(username);
    if (user && (await bcrypt.compare(pass, user.password))) {
      return user;
    }
    return;
  }
}
