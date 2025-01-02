import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { GameroomService } from './gameroom.service';
import { CreateGameroomDto } from './dto/create-gameroom.dto';
import { UpdateGameroomDto } from './dto/update-gameroom.dto';

@Controller('gameroom')
export class GameroomController {
  constructor(private readonly gameroomService: GameroomService) {}

  @Post()
  create(@Body() createGameroomDto: CreateGameroomDto) {
    return this.gameroomService.create(createGameroomDto);
  }

  @Get()
  findAll() {
    return this.gameroomService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.gameroomService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateGameroomDto: UpdateGameroomDto) {
    return this.gameroomService.update(+id, updateGameroomDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.gameroomService.remove(+id);
  }
}
