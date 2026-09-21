import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { ApplicationTokenGuard } from './application-token.guard';
import { ChefApplicationsAdminController } from './chef-applications-admin.controller';
import { ChefApplicationsController } from './chef-applications.controller';
import { ChefDocumentsController } from './chef-documents.controller';
import { ReferentialsController } from './referentials.controller';
import { ChefApplicationsAdminService } from './services/chef-applications-admin.service';
import { ChefApplicationsService } from './services/chef-applications.service';
import { ChefDocumentsService } from './services/chef-documents.service';
import { ChefDossierCron } from './services/chef-dossier.cron';
import { ChefOnboardingMailer } from './services/chef-onboarding.mailer';
import { KycStorageService } from './services/kyc-storage.service';

/** FLOW-01 — candidature, KYC documents, admin validation, living dossier. */
@Module({
  imports: [UsersModule],
  controllers: [
    ChefApplicationsController,
    ChefApplicationsAdminController,
    ChefDocumentsController,
    ReferentialsController,
  ],
  providers: [
    ApplicationTokenGuard,
    ChefApplicationsService,
    ChefApplicationsAdminService,
    ChefDocumentsService,
    ChefDossierCron,
    ChefOnboardingMailer,
    KycStorageService,
  ],
  exports: [ChefDocumentsService],
})
export class ChefOnboardingModule {}
