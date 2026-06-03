import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: ['http://localhost:5173', 'http://localhost:4173'],
    methods: ['GET', 'POST'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log(`\n  ╔══════════════════════════════════════════════════╗`);
  console.log(`  ║  newVue Normalization API (NestJS)               ║`);
  console.log(`  ║  API: http://localhost:${port}/api/health            ║`);
  console.log(`  ╚══════════════════════════════════════════════════╝\n`);
}

bootstrap();
