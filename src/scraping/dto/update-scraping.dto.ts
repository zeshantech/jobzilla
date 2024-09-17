import { PartialType } from '@nestjs/mapped-types';
import { CreateScrapingDto } from './create-scraping.dto';

export class UpdateScrapingDto extends PartialType(CreateScrapingDto) {}
