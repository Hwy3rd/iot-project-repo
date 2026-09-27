import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiPredictionService } from './ai-prediction.service';

@Module({
  imports: [ConfigModule],
  providers: [AiPredictionService],
  exports: [AiPredictionService],
})
export class AiPredictionModule {}
