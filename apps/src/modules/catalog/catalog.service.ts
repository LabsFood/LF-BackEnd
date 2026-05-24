import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class CatalogService {
  constructor(private readonly config: ConfigService) {}
}
