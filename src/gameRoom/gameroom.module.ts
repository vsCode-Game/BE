import { Module } from '@nestjs/common';
import { GameroomService } from './gameroom.service';
import { GameroomController } from './gameroom.controller';

@Module({
  controllers: [GameroomController],
  providers: [GameroomService],
})
export class GameroomModule {}
