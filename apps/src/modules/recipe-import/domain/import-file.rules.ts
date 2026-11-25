/**
 * Import de recettes (DAT §4 ter) : ce qu'on accepte d'un fichier, lu sur ses
 * premiers octets et non sur le type annoncé.
 */

import { detectImageType } from '../../../integrations/r2-storage.service';

export const IMPORT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type ImportMime = (typeof IMPORT_MIME_TYPES)[number];

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 20;
/** Plusieurs photos d'une même recette (recto, verso). */
export const MAX_IMPORT_FILES = 4;

/** Le vrai type du fichier, `image/heic` compris pour pouvoir le refuser clairement. */
export function sniffType(bytes: Buffer): ImportMime | 'image/heic' | null {
  if (bytes.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  const image = detectImageType(bytes);
  if (image) return image as ImportMime;
  const brand = bytes.subarray(4, 12).toString('latin1');
  if (/^ftyp(heic|heix|hevc|mif1|msf1)/.test(brand)) return 'image/heic';
  return null;
}

/**
 * Ce qu'on lit d'un PDF sans le décoder : chiffré ou non, et le nombre de pages
 * (objets `/Type /Page`, approximation suffisante pour une limite).
 */
export function pdfInfo(bytes: Buffer): { encrypted: boolean; pages: number } {
  const text = bytes.toString('latin1');
  return {
    encrypted: /\/Encrypt\s/.test(text),
    pages: (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length,
  };
}

export type FileProblem =
  | { code: 'UNSUPPORTED_MEDIA_TYPE'; message: string }
  | { code: 'FILE_TOO_LARGE'; message: string }
  | { code: 'PDF_ENCRYPTED'; message: string }
  | { code: 'PDF_TOO_LONG'; message: string };

/** Le motif du refus, ou `null` quand le fichier passe. */
export function fileProblem(bytes: Buffer): FileProblem | null {
  if (bytes.length > MAX_IMPORT_BYTES) {
    return {
      code: 'FILE_TOO_LARGE',
      message: `Fichier trop lourd : ${MAX_IMPORT_BYTES / 1024 / 1024} Mo au plus.`,
    };
  }
  const type = sniffType(bytes);
  if (type === 'image/heic') {
    return {
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message:
        'Photo au format HEIC : réglez l’appareil photo sur « Le plus compatible » ou envoyez une capture.',
    };
  }
  if (!type) {
    return {
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'Formats acceptés : PDF, JPEG, PNG, WebP.',
    };
  }
  if (type === 'application/pdf') {
    const info = pdfInfo(bytes);
    if (info.encrypted)
      return {
        code: 'PDF_ENCRYPTED',
        message: 'Ce PDF est protégé par un mot de passe.',
      };
    if (info.pages > MAX_PDF_PAGES) {
      return {
        code: 'PDF_TOO_LONG',
        message: `PDF trop long : ${MAX_PDF_PAGES} pages au plus.`,
      };
    }
  }
  return null;
}
