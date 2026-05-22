import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { AvailabilitySlot } from './availability-slot.entity';
import { Booking } from './booking.entity';
import { ServiceOffer } from './service-offer.entity';
import { User } from './user.entity';

@Entity({ name: 'provider_profiles' })
export class ProviderProfile {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id', unique: true })
  userId!: string;

  @OneToOne(() => User, (user) => user.providerProfile, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 255, name: 'display_name' })
  displayName!: string;

  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city!: string | null;

  @Column({ type: 'integer', name: 'service_radius_km', default: 10 })
  serviceRadiusKm!: number;

  @Column({ type: 'boolean', name: 'is_active', default: false })
  isActive!: boolean;

  @Column({ type: 'boolean', name: 'is_verified', default: false })
  isVerified!: boolean;

  @Column({ type: 'varchar', length: 128, name: 'cronofy_profile_id', nullable: true })
  cronofyProfileId!: string | null;

  @Column({ type: 'varchar', length: 128, name: 'stripe_account_id', nullable: true })
  stripeAccountId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ServiceOffer, (offer) => offer.provider)
  offers?: ServiceOffer[];

  @OneToMany(() => AvailabilitySlot, (slot) => slot.provider)
  slots?: AvailabilitySlot[];

  @OneToMany(() => Booking, (booking) => booking.provider)
  bookings?: Booking[];
}
