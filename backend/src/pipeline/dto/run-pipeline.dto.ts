import { IsIn, IsNotEmpty, IsString } from 'class-validator';

const VALID_MODALITIES = ['CT', 'MR', 'US', 'XR', 'FL', 'MG', 'NM', 'IR'] as const;

export class RunPipelineDto {
  @IsString()
  @IsNotEmpty()
  rawStudyName: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(VALID_MODALITIES, {
    message: `modality must be one of: ${VALID_MODALITIES.join(', ')}`,
  })
  modality: string;
}
