import { Injectable, Logger } from '@nestjs/common';
import * as puppeteer from 'puppeteer';
import { ConfigService } from '@nestjs/config';
import { ZenRows } from 'zenrows';
import axios from 'axios';

@Injectable()
export class LinkedinService {
  private readonly logger = new Logger(LinkedinService.name);

  private readonly keywords = [
    'full stack developer',
    'data scientist',
    'product manager',
    'software engineer',
    'machine learning engineer',
    'devops engineer',
    'frontend developer',
    'backend developer',
    'cybersecurity analyst',
    'cloud architect',
    'database administrator',
    'mobile app developer',
    'AI researcher',
    'UI/UX designer',
    'IT project manager',
    'business analyst',
    'network engineer',
    'systems administrator',
    'QA engineer',
    'technical writer',
  ];

  private readonly MAX_JOBS_PER_KEYWORD = 200;
  private readonly JOBS_PER_PAGE = 25;
  private readonly MAX_JOB_AGE_DAYS = 30;
  private readonly MAX_CONCURRENT_PAGES = 5;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('ZENROWS_API_KEY');
    if (!apiKey) {
      throw new Error('ZenRows API key is not set. Please define ZENROWS_API_KEY in your environment variables.');
    }
  }

  private async fetchPage(url: string): Promise<string | null> {
    try {
      const data = await axios({
        url: 'https://api.zenrows.com/v1/',
        method: 'GET',
        params: {
          url: url,
          apikey: this.configService.get<string>('ZENROWS_API_KEY'),
          js_render: 'true',
          premium_proxy: 'true',
        },
      });

      return data.data;
    } catch (error: any) {
      if (error.response) {
        this.logger.error(`Error to fetching by proxy (${url}):`, error.message);
        return null;
      }
    }
  }

  private async launchBrowser(): Promise<puppeteer.Browser> {
    try {
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: '/usr/bin/google-chrome',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      return browser;
    } catch (error: any) {
      this.logger.error('Error launching Puppeteer browser:', error.message);
      throw error;
    }
  }

  private async getJobHrefs(htmlContent: string, keyword: string, browser: puppeteer.Browser): Promise<string[]> {
    const page = await browser.newPage();
    try {
      await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.job-search-card', { timeout: 10000 });

      const jobHrefs = await page.evaluate(() => {
        const jobElements = document.querySelectorAll('.job-search-card');
        const jobData: string[] = [];

        jobElements.forEach((job) => {
          const jobHref = job.querySelector('a.base-card__full-link')?.getAttribute('href') || '';
          if (jobHref) {
            jobData.push(jobHref);
          }
        });

        return jobData;
      });

      this.logger.log(`Extracted ${jobHrefs.length} job links for keyword "${keyword}".`);
      return jobHrefs;
    } catch (error: any) {
      this.logger.error(`Error extracting job hrefs for keyword "${keyword}":`, error.message);
      return [];
    } finally {
      await page.close();
    }
  }

  private async scrapeJobDetails(jobHref: string, browser: puppeteer.Browser): Promise<any> {
    const jobPage = await browser.newPage();
    try {
      const htmlContent = await this.fetchPage(jobHref);

      if (!htmlContent) {
        throw new Error('Failed to fetch job page content.');
      }

      await jobPage.setContent(htmlContent, { waitUntil: 'domcontentloaded' });
      await jobPage.waitForSelector('.details.mx-details-container-padding', { timeout: 15000 });

      const jobDetails = await jobPage.evaluate(() => {
        const getTextContent = (selector: string): string => {
          const element = document.querySelector(selector);
          return element ? element.textContent.trim() : '';
        };

        const getAttribute = (selector: string, attribute: string): string => {
          const element = document.querySelector(selector);
          return element ? element.getAttribute(attribute) || '' : '';
        };

        const companyLogo = getAttribute('[data-tracking-control-name="public_jobs_topcard_logo"] img', 'src');
        const title = getTextContent('.top-card-layout__title');
        const companyTag = document.querySelector('.topcard__org-name-link, .top-card-layout__subtitle > a');
        const company = companyTag ? companyTag.textContent.trim() : 'Not specified';
        const companyHref = companyTag ? companyTag.getAttribute('href') : 'Not specified';
        const location = getTextContent('.topcard__flavor--bullet, .top-card-layout__first-subline');
        const address = getTextContent('.top-card-layout__second-subline');
        const applicants = getTextContent('.num-applicants__caption');
        const postedBefore = getTextContent('.posted-time-ago__text, .topcard__flavor--metadata');
        const easyApply = !!document.querySelector('.apply-button');
        const payRange = getTextContent('.compensation__salary');
        const employmentType = getTextContent('.description__job-criteria-text--criteria');
        const seniorityLevel = getTextContent('.description__job-criteria-text');

        return {
          title,
          location,
          address,
          company,
          companyHref,
          employmentType,
          applicants,
          payRange,
          easyApply,
          postedBefore,
          companyLogo,
          seniorityLevel,
        };
      });

      jobDetails['href'] = jobHref;
      this.logger.log(`Scraped job details for: ${jobHref}`);
      return jobDetails;
    } catch (error: any) {
      this.logger.error(`Error scraping job at: ${jobHref} - ${error.message}`);
      return { error: `Failed to scrape job: ${jobHref}`, href: jobHref };
    } finally {
      await jobPage.close();
    }
  }

  private categorizeByCountry(jobs: any[]): { [country: string]: any[] } {
    const categorizedJobs: { [country: string]: any[] } = {};

    jobs.forEach((job) => {
      const countryMatch = job.location.match(/,\s*([A-Za-z\s]+)$/);
      const country = countryMatch ? countryMatch[1].trim() : 'Unknown';

      if (!categorizedJobs[country]) {
        categorizedJobs[country] = [];
      }
      categorizedJobs[country].push(job);
    });

    return categorizedJobs;
  }

  private filterOldJobs(jobs: any[]): any[] {
    const filteredJobs = jobs.filter((job) => {
      const postedBefore = job.postedBefore.toLowerCase();

      if (postedBefore.includes('just now') || postedBefore.includes('minute') || postedBefore.includes('hour')) {
        return true;
      }

      const daysMatch = postedBefore.match(/(\d+)\s+day/);
      const weeksMatch = postedBefore.match(/(\d+)\s+week/);
      const monthsMatch = postedBefore.match(/(\d+)\s+month/);

      if (daysMatch) {
        return parseInt(daysMatch[1], 10) <= this.MAX_JOB_AGE_DAYS;
      } else if (weeksMatch) {
        return parseInt(weeksMatch[1], 10) * 7 <= this.MAX_JOB_AGE_DAYS;
      } else if (monthsMatch) {
        return parseInt(monthsMatch[1], 10) * 30 <= this.MAX_JOB_AGE_DAYS;
      }

      return false;
    });

    return filteredJobs;
  }

  private async processWithConcurrencyLimit<T>(items: T[], limit: number, asyncFn: (item: T) => Promise<any>): Promise<any[]> {
    const results: any[] = [];
    let index = 0;

    const execute = async () => {
      while (index < items.length) {
        const currentIndex = index++;
        try {
          const result = await asyncFn(items[currentIndex]);
          results[currentIndex] = result;
        } catch (error: any) {
          this.logger.error(`Error processing item at index ${currentIndex}: ${error.message}`);
          results[currentIndex] = { error: `Failed to process item at index ${currentIndex}` };
        }
      }
    };

    const workers = Array.from({ length: limit }, () => execute());

    await Promise.all(workers);

    return results;
  }

  async scrapeJobs(): Promise<any> {
    const allJobs: any[] = [];
    const browser = await this.launchBrowser();

    try {
      for (const keyword of this.keywords) {
        this.logger.log(`\nScraping jobs for keyword: "${keyword}"`);
        let jobsCollected = 0;
        let start = 0;
        const keywordJobs: any[] = [];

        while (jobsCollected < this.MAX_JOBS_PER_KEYWORD) {
          const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&start=${start}`;

          this.logger.log(`Fetching job search page: ${searchUrl}`);
          const htmlContent = await this.fetchPage(searchUrl);

          if (!htmlContent) {
            this.logger.error(`Failed to retrieve job search page for keyword "${keyword}" at start ${start}.`);
            break;
          }

          const jobHrefs = await this.getJobHrefs(htmlContent, keyword, browser);

          const newJobHrefs = jobHrefs.filter((href) => !keywordJobs.some((job) => job.href === href));

          if (newJobHrefs.length === 0) {
            this.logger.log(`No more new jobs found for keyword "${keyword}" at start ${start}.`);
            break;
          }

          this.logger.log(`Found ${newJobHrefs.length} new job(s) for keyword "${keyword}".`);

          const jobDetailsArray = await this.processWithConcurrencyLimit(newJobHrefs, this.MAX_CONCURRENT_PAGES, async (href) => this.scrapeJobDetails(href, browser));

          keywordJobs.push(...jobDetailsArray);
          jobsCollected += newJobHrefs.length;
          start += this.JOBS_PER_PAGE;

          this.logger.log(`Collected ${jobsCollected} jobs for keyword "${keyword}".`);

          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        const filteredJobs = this.filterOldJobs(keywordJobs);
        this.logger.log(`After filtering, ${filteredJobs.length} jobs remain for keyword "${keyword}".`);

        const categorizedJobs = this.categorizeByCountry(filteredJobs);

        allJobs.push({
          keyword,
          jobs: categorizedJobs,
        });

        this.logger.log(`Finished scraping for keyword "${keyword}".`);
      }
    } catch (error: any) {
      this.logger.error(`Unexpected error during scraping: ${error.message}`);
    } finally {
      await browser.close();
    }

    return allJobs;
  }
}
