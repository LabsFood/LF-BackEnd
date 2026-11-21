import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { AiAlertsService } from './ai-alerts.service';
import { AiBudgetService } from './ai-budget.service';
import { AiController } from './ai.controller';
import { AI_PROVIDERS, AiGateway } from './ai-gateway.service';
import { AiUsageService } from './ai-usage.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { MistralProvider } from './providers/mistral.provider';

/** Budget IA (DAT 6 bis) : `AiGateway`, seul chemin vers un fournisseur, et la page console. */
@Module({
  imports: [UsersModule],
  controllers: [AiController],
  providers: [
    AiGateway,
    AiBudgetService,
    AiAlertsService,
    AiUsageService,
    {
      provide: AI_PROVIDERS,
      useFactory: () => [new MistralProvider(), new AnthropicProvider()],
    },
  ],
  exports: [AiGateway],
})
export class AiModule {}
