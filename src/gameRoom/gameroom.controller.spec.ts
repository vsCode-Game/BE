import { Test, TestingModule } from '@nestjs/testing';
import { GameroomController } from './gameroom.controller';
import { GameroomService } from './gameroom.service';

describe('GameroomController', () => {
  let controller: GameroomController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GameroomController],
      providers: [GameroomService],
    }).compile();

    controller = module.get<GameroomController>(GameroomController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
