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

import { ProviderProfile } from './provider-profile.entity';
import { ServiceOffer } from './service-offer.entity';
import { User } from './user.entity';

export enum BookingStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
}

@Entity({ name: 'bookings' })
export class Booking {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index('ix_bookings_client_id')
  @Column({ type: 'uuid', name: 'client_id' })
  clientId!: string;

  @ManyToOne(() => User, (user) => user.bookings, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'client_id' })
  client!: User;

  @Index('ix_bookings_provider_id')
  @Column({ type: 'uuid', name: 'provider_id' })
  providerId!: string;

  @ManyToOne(() => ProviderProfile, (provider) => provider.bookings, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'provider_id' })
  provider!: ProviderProfile;

  @Column({ type: 'uuid', name: 'service_offer_id' })
  serviceOfferId!: string;

  @ManyToOne(() => ServiceOffer, (offer) => offer.bookings, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'service_offer_id' })
  serviceOffer!: ServiceOffer;

  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt!: Date;

  @Column({ type: 'timestamptz', name: 'ends_at' })
  endsAt!: Date;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    enumName: 'booking_status',
    default: BookingStatus.PENDING,
  })
  status!: BookingStatus;

  @Column({ type: 'integer', name: 'price_cents' })
  priceCents!: number;

  @Column({ type: 'varchar', length: 3, default: 'EUR' })
  currency!: string;

  @Column({ type: 'varchar', length: 255, name: 'address_line', nullable: true })
  addressLine!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @Column({
    type: 'varchar',
    length: 128,
    name: 'stripe_payment_intent_id',
    nullable: true,
  })
  stripePaymentIntentId!: string | null;

  @Column({ type: 'varchar', length: 128, name: 'cronofy_event_id', nullable: true })
  cronofyEventId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
