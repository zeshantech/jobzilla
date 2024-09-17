import { Test, TestingModule } from '@nestjs/testing';
import { IndeedService } from './indeed.service';

describe('IndeedService', () => {
  let service: IndeedService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [IndeedService],
    }).compile();

    service = module.get<IndeedService>(IndeedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
