import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { RunPipelineDto } from './dto/run-pipeline.dto';
import { PipelineService } from './pipeline.service';

@Controller('api')
export class PipelineController {
  private readonly logger = new Logger(PipelineController.name);

  constructor(private readonly pipelineService: PipelineService) {}

  @Post('run-pipeline')
  async runPipeline(@Body() dto: RunPipelineDto) {
    this.logger.log(`Running pipeline: "${dto.rawStudyName}" (${dto.modality})`);
    try {
      return await this.pipelineService.runPipeline(dto);
    } catch (err) {
      this.logger.error(`Pipeline failed: ${err.message}`);
      throw new HttpException(
        {
          success: false,
          error: err.message,
          result: {
            rawStudyName: dto.rawStudyName.trim(),
            normalizedStudyName: dto.rawStudyName.trim(),
            modality: dto.modality.trim().toUpperCase(),
            confidence: 'Program Failure',
            explanation: `Server error: ${err.message}`,
            bestMatch: { enterpriseName: '', matchNumber: 0, source: 'error' },
          },
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
