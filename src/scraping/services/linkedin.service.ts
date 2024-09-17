import { Injectable } from '@nestjs/common';
import * as puppeteer from 'puppeteer';

@Injectable()
export class LinkedinService {
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
    // ... Continue adding up to 100 keywords
  ];

  private readonly MAX_JOBS_PER_KEYWORD = 200;
  private readonly JOBS_PER_PAGE = 25; // LinkedIn displays 25 jobs per page
  private readonly MAX_JOB_AGE_DAYS = 30; // Filter out jobs older than 30 days
  private readonly CONCURRENT_BROWSERS = 10; // Number of browser instances to run concurrently

  /**
   * Launches a new Puppeteer browser instance.
   */
  private async launchBrowser(): Promise<puppeteer.Browser> {
    return await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
      defaultViewport: null,
    });
  }

  /**
   * Fetches job URLs for a given keyword and start index.
   */
  private async getJobHrefs(page: puppeteer.Page, keyword: string, start: number): Promise<string[]> {
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keyword)}&start=${start}`;

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    // Wait for jobs to load
    await page.waitForSelector('.job-search-card');

    // Collect job hrefs
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

    return jobHrefs;
  }

  /**
   * Scrapes detailed information from a job posting.
   */
  private async scrapeJobDetails(jobHref: string, browser: puppeteer.Browser): Promise<any> {
    const jobPage = await browser.newPage();
    try {
      await jobPage.goto(jobHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await jobPage.waitForSelector('.details.mx-details-container-padding', { timeout: 15000 });

      const jobDetails = await jobPage.evaluate(() => {
        const getTextContent = (selector: string): string => {
          const element = document.querySelector(selector);
          return element ? element.textContent.trim() : 'Not specified';
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
        const address = getTextContent('.top-card-layout__second-subline'); // New: Address
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

      jobDetails['href'] = jobHref; // Store the job URL
      return jobDetails;
    } catch (error) {
      console.error(`Error scraping job at: ${jobHref} - ${error}`);
      return { error: `Failed to scrape job: ${jobHref}`, href: jobHref };
    } finally {
      await jobPage.close();
    }
  }

  /**
   * Categorizes jobs based on the country extracted from the location.
   */
  private categorizeByCountry(jobs: any[]): { [country: string]: any[] } {
    const categorizedJobs: { [country: string]: any[] } = {};

    jobs.forEach((job) => {
      const countryMatch = job.location.match(/,\s*(\w+)$/);
      const country = countryMatch ? countryMatch[1] : 'Unknown';

      if (!categorizedJobs[country]) {
        categorizedJobs[country] = [];
      }
      categorizedJobs[country].push(job);
    });

    return categorizedJobs;
  }

  /**
   * Filters out jobs that are older than the specified number of days.
   */
  private filterOldJobs(jobs: any[]): any[] {
    const filteredJobs = jobs.filter((job) => {
      const postedBefore = job.postedBefore.toLowerCase();

      if (postedBefore.includes('just now') || postedBefore.includes('minutes ago') || postedBefore.includes('hour ago') || postedBefore.includes('hours ago')) {
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

  /**
   * Distributes keywords evenly across a specified number of browsers.
   */
  private distributeKeywords(keywords: string[], numBrowsers: number): string[][] {
    const distribution: string[][] = Array.from({ length: numBrowsers }, () => []);
    keywords.forEach((keyword, index) => {
      distribution[index % numBrowsers].push(keyword);
    });
    return distribution;
  }

  /**
   * Scrapes jobs for a given set of keywords using a single browser instance.
   */
  private async scrapeKeywordsWithBrowser(keywords: string[], browser: puppeteer.Browser): Promise<any[]> {
    const detailedJobs = [];

    for (const keyword of keywords) {
      console.log(`Browser ${browser.process().pid}: Starting keyword "${keyword}"`);
      let jobsCollected = 0;
      let start = 0;
      const keywordJobs = [];

      while (jobsCollected < this.MAX_JOBS_PER_KEYWORD) {
        try {
          const page = await browser.newPage();
          const jobHrefs = await this.getJobHrefs(page, keyword, start);
          await page.close();

          // Remove duplicates
          const newJobHrefs = jobHrefs.filter((href) => !keywordJobs.some((job) => job.href === href));

          if (newJobHrefs.length === 0) {
            // No new jobs found, break the loop
            break;
          }

          // Scrape job details in parallel
          const scrapeJobPromises = newJobHrefs.map((href) => this.scrapeJobDetails(href, browser));
          const jobDetailsArray = await Promise.all(scrapeJobPromises);

          keywordJobs.push(...jobDetailsArray);
          jobsCollected += newJobHrefs.length;
          start += this.JOBS_PER_PAGE;

          console.log(`Browser ${browser.process().pid}: Collected ${jobsCollected} jobs for keyword "${keyword}"`);

          // Optional delay to prevent rate limiting
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          console.error(`Browser ${browser.process().pid}: Error processing keyword "${keyword}" at start ${start}: ${error}`);
          break;
        }
      }

      // Filter out old jobs
      const filteredJobs = this.filterOldJobs(keywordJobs);

      // Categorize by country
      const categorizedJobs = this.categorizeByCountry(filteredJobs);

      detailedJobs.push({
        keyword,
        jobs: categorizedJobs,
      });
    }

    return detailedJobs;
  }

  /**
   * Main function to scrape jobs using multiple browsers concurrently.
   */
  async scrapeJobs(): Promise<any[]> {
    // Distribute keywords across the number of browsers
    const keywordBatches = this.distributeKeywords(this.keywords, this.CONCURRENT_BROWSERS);

    // Launch browsers
    const browserPromises = Array.from({ length: this.CONCURRENT_BROWSERS }, () => this.launchBrowser());
    const browsers = await Promise.all(browserPromises);

    console.log(`Launched ${browsers.length} browser instances.`);

    try {
      // Assign each batch of keywords to a browser
      const scrapePromises = keywordBatches.map((keywords, index) => this.scrapeKeywordsWithBrowser(keywords, browsers[index]));

      // Wait for all browsers to finish scraping
      const results = await Promise.all(scrapePromises);

      // Flatten the results
      const allJobs = results.flat();

      return allJobs;
    } catch (error) {
      console.error(`Error during scraping: ${error}`);
      return [];
    } finally {
      // Close all browsers
      const closePromises = browsers.map((browser) => browser.close());
      await Promise.all(closePromises);
      console.log(`All browsers closed.`);
    }
  }
}
