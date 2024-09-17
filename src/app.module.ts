import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScrapingModule } from './scraping/scraping.module';

@Module({
  imports: [ScrapingModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
