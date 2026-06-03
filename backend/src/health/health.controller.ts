import { Controller, Get } from '@nestjs/common';
import * as path from 'path';

@Controller('api')
export class HealthController {
  private readonly version: string;

  constructor() {
    const pkg = require(path.resolve(process.cwd(), 'package.json'));
    this.version = pkg.version;
  }

  @Get('health')
  health() {
    return {
      status: 'ok',
      version: this.version,
      timestamp: new Date().toISOString(),
    };
  }
}
