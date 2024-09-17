import { Injectable } from '@nestjs/common';
import puppeteer from 'puppeteer';
import axios from 'axios';

@Injectable()
export class ScrapingService {
  async scrapeAllPlatforms() {
    const ZENROWS_API_KEY = '';

    async function fetchPage(url: string): Promise<string | null> {
      try {
        const response = await axios.get('https://api.zenrows.com/v1/', {
          params: {
            url: url,
            apikey: ZENROWS_API_KEY,
          },
        });
        return response.data;
      } catch (error) {
        console.error('Error fetching page:', error.message);
        return null;
      }
    }

    try {
      const targetUrl = 'https://ip.me/';
      const htmlContent = await fetchPage(targetUrl);

      if (!htmlContent) {
        console.error('Failed to retrieve page content.');
        return;
      }

      const browser = await puppeteer.launch({
        headless: false,
        executablePath: '/usr/bin/google-chrome',
      });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');

      await page.setContent(htmlContent, { waitUntil: 'networkidle2' });

      const displayedIp = await page.$eval('body', (el) => el.innerText.trim());
      console.log('Displayed IP:', displayedIp);

      await page.screenshot({ path: 'screenshot.png', fullPage: true });

      await browser.close();
    } catch (error) {
      console.error('Error:', error);
    }
  }
}
