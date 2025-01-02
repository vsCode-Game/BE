import { Injectable } from '@nestjs/common';
import { CreateGameroomDto } from './dto/create-gameroom.dto';
import { UpdateGameroomDto } from './dto/update-gameroom.dto';

@Injectable()
export class GameroomService {
  create(createGameroomDto: CreateGameroomDto) {
    return 'This action adds a new gameroom';
  }

  findAll() {
    return `This action returns all gameroom`;
  }

  findOne(id: number) {
    return `This action returns a #${id} gameroom`;
  }

  update(id: number, updateGameroomDto: UpdateGameroomDto) {
    return `This action updates a #${id} gameroom`;
  }

  remove(id: number) {
    return `This action removes a #${id} gameroom`;
  }
}
