import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';

import { SupabaseService } from '../../integrations/supabase.service';

const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Import de recettes : les fiches envoyées par les cuisiniers, dans un bucket privé
 * (jamais d'URL publique). Le navigateur dépose le fichier directement ; l'API le
 * relit pour l'envoyer au modèle, puis la purge l'efface au bout de 30 jours.
 */
@Injectable()
export class RecipeImportStorageService {
  private readonly logger = new Logger(RecipeImportStorageService.name);
  private readonly bucket: string;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService,
  ) {
    this.bucket = config.get<string>(
      'supabase.recipeImportsBucket',
      'labsfood-recipe-imports',
    );
  }

  private api() {
    if (!this.supabase.configured) {
      throw new ServiceUnavailableException({
        code: 'RECIPE_IMPORT_STORAGE_UNAVAILABLE',
        message: "Le stockage des fiches n'est pas configuré.",
      });
    }
    return this.supabase.getClient().storage.from(this.bucket);
  }

  /** Un dépôt sous le dossier du cuisinier : le chemin ne peut pas sortir de chez lui. */
  async createUploadUrl(chefProfileId: string, mimeType: string) {
    const uploadId = `ri_${randomBytes(12).toString('hex')}`;
    const storagePath = `${chefProfileId}/${uploadId}`;
    const { data, error } = await this.api().createSignedUploadUrl(storagePath);
    if (error || !data) {
      this.logger.error({
        event: 'recipe_import.upload_url_failed',
        error: error?.message,
      });
      throw new ServiceUnavailableException('Could not prepare the upload.');
    }
    return {
      uploadId,
      method: 'PUT' as const,
      url: data.signedUrl,
      headers: { 'Content-Type': mimeType },
      expiresAt: new Date(Date.now() + UPLOAD_TTL_MS),
    };
  }

  pathOf(chefProfileId: string, uploadId: string): string | null {
    return /^ri_[0-9a-f]{24}$/.test(uploadId) ? `${chefProfileId}/${uploadId}` : null;
  }

  /** Le fichier, ou `null` s'il n'a jamais été déposé. */
  async read(storagePath: string): Promise<Buffer | null> {
    const { data, error } = await this.api().download(storagePath);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(storagePaths: string[]): Promise<void> {
    if (storagePaths.length === 0) return;
    const { error } = await this.api().remove(storagePaths);
    if (error) throw new Error(`recipe import purge failed: ${error.message}`);
  }
}
