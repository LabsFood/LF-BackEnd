import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
  } from 'typeorm';
  
  import { Booking } from './booking.entity';
  import { User } from './user.entity';
  import { ServiceOffer } from './service-offer.entity';

  @Entity({ name: 'cms_pages' })
  export class CmsPage {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'varchar', length: 255 })
    slug!: string;
  }