import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as path from 'path';
import { RunPipelineDto } from './dto/run-pipeline.dto';
import { initialize, normalizeMapAndAssignCpt } from './core/index';

@Injectable()
export class PipelineService implements OnModuleInit {
  private readonly logger = new Logger(PipelineService.name);
  private readonly dataDir = path.resolve(process.cwd(), 'data');

  onModuleInit() {
    this.logger.log('Initializing normalization pipeline...');
    const start = Date.now();
    initialize({ dataDir: this.dataDir });
    this.logger.log(`Pipeline initialized in ${Date.now() - start}ms`);
  }

  async runPipeline(dto: RunPipelineDto) {
    const rawStudyName = dto.rawStudyName.trim();
    const modality = dto.modality.trim().toUpperCase();
    const startTime = Date.now();

    const result = await normalizeMapAndAssignCpt({ rawStudyName, modality });

    return {
      success: true,
      elapsedMs: Date.now() - startTime,
      timings: result.timings,
      result,
    };
  }
}
