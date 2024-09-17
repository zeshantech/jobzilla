import { Module } from '@nestjs/common';
import { ScrapingService } from './scraping.service';
import { ScrapingController } from './scraping.controller';
import { LinkedinService } from './services/linkedin.service';
import { IndeedService } from './services/indeed.service';
import { MonsterService } from './services/monster.service';

@Module({
  controllers: [ScrapingController],
  providers: [ScrapingService, LinkedinService, IndeedService, MonsterService],
})
export class ScrapingModule {}
