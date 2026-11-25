import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PERIOD_LABELS, type Period } from './domain/ai-periods.rules';

/** Mode strict : un plafond concerné est atteint, l'appel n'est pas envoyé. */
export const aiBudgetReached = (scope: string, period: Period): HttpException =>
  new HttpException(
    {
      code: 'AI_BUDGET_REACHED',
      message: `Le budget IA (${scope}, ${PERIOD_LABELS[period].toLowerCase()}) est atteint. Réessayez plus tard ou saisissez la recette à la main.`,
      scope,
      period,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

/** Aucun modèle n'a pu répondre (fournisseur en panne, clé absente, délai dépassé). */
export const aiUnavailable = (): BadGatewayException =>
  new BadGatewayException({
    code: 'AI_UNAVAILABLE',
    message: "Le service d'IA ne répond pas pour le moment.",
  });

/** La fonctionnalité n'est pas ouverte (réglage de la console). */
export const aiFeatureClosed = (): ServiceUnavailableException =>
  new ServiceUnavailableException({
    code: 'AI_FEATURE_CLOSED',
    message: "Cette fonctionnalité n'est pas encore ouverte à votre compte.",
  });
