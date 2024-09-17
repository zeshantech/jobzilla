import { Injectable } from '@nestjs/common';
import { LinkedinService } from './services/linkedin.service';
import { IndeedService } from './services/indeed.service';

@Injectable()
export class ScrapingService {
  constructor(
    private readonly linkedinService: LinkedinService,
    private readonly indeedScraperService: IndeedService,
  ) {}

  async scrapeAllPlatforms() {
    const linkedinJobs = await this.linkedinService.scrapeJobs();
    console.log(linkedinJobs);
  }
}
