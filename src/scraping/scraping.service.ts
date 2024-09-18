import { Injectable } from '@nestjs/common';
import { LinkedinService } from './services/linkedin.service';

@Injectable()
export class ScrapingService {
  constructor(private linkedinService: LinkedinService) {}

  async scrapeAllPlatforms() {
    const jobs = await this.linkedinService.scrapeJobs();
    return jobs;
  }
}
