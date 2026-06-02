/** JSON column shapes for `cms_pages` (Prisma `Json` fields). */

export interface CmsImageRef {
  src: string;
  alt: string;
}

export interface CmsHeroContent {
  title: string;
  subtitle: string;
  image?: CmsImageRef;
}

export interface CmsIntroBlock {
  title?: string;
  body: string;
}

export interface CmsHowItWorksStep {
  title: string;
  description: string;
  image?: CmsImageRef;
}

export interface CmsReassuranceItem {
  title: string;
  description: string;
  icon?: string;
}

export enum CmsPageStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}
