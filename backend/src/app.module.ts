import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { PipelineModule } from './pipeline/pipeline.module';

@Module({
  imports: [HealthModule, PipelineModule],
})
export class AppModule {}
