import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from './user.entity';

export enum CmsPageStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}

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

@Entity({ name: 'cms_pages' })
export class CmsPage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  slug!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'jsonb' })
  hero!: CmsHeroContent;

  @Column({ name: 'intro_blocks', type: 'jsonb' })
  introBlocks!: CmsIntroBlock[];

  @Column({ name: 'how_it_works', type: 'jsonb' })
  howItWorks!: CmsHowItWorksStep[];

  @Column({ name: 'reassurance_items', type: 'jsonb' })
  reassuranceItems!: CmsReassuranceItem[];

  @Column({ type: 'varchar', length: 32, default: CmsPageStatus.PUBLISHED })
  status!: CmsPageStatus;

  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'updated_by_user_id' })
  updatedByUser?: User | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
