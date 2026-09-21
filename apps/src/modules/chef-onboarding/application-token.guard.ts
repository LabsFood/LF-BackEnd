import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { ChefApplication } from '../../generated/prisma/client';
import { ChefApplicationsService } from './services/chef-applications.service';

export interface ApplicationRequest {
  params: { id?: string };
  query: { token?: string };
  headers: Record<string, string | undefined>;
  chefApplication?: ChefApplication;
}

/**
 * Authenticates a candidate who has no account (FLOW-01 §4).
 *
 * Scope is deliberately minimal: the token proves nothing except ownership of the
 * candidature named in the route, so it can read that dossier and deposit its
 * documents, and nothing else.
 *
 * Accepts the token from `Authorization: Bearer` or from `?token=`, because the
 * email link carries it in the query string before the frontend takes over.
 */
@Injectable()
export class ApplicationTokenGuard implements CanActivate {
  constructor(private readonly applications: ChefApplicationsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ApplicationRequest>();

    const applicationId = req.params?.id;
    if (!applicationId) throw new UnauthorizedException('Missing candidature id.');

    const header = req.headers['authorization'];
    const bearer = header?.toLowerCase().startsWith('bearer ')
      ? header.slice(7).trim()
      : undefined;
    const token = bearer ?? req.query?.token;
    if (!token) {
      throw new UnauthorizedException('Missing candidature token.');
    }

    // Throws TOKEN_EXPIRED / TOKEN_INVALID with the codes the flow document names.
    req.chefApplication = await this.applications.resolveByToken(applicationId, token);
    return true;
  }
}
