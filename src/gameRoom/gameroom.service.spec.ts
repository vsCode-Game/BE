import { Test, TestingModule } from '@nestjs/testing';
import { GameroomService } from './gameroom.service';

describe('GameroomService', () => {
  let service: GameroomService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GameroomService],
    }).compile();

    service = module.get<GameroomService>(GameroomService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
