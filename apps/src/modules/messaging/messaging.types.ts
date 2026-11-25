import type { BookingStatus } from '../../generated/prisma/client';

export type ConversationKind = 'chef_client' | 'support';
export type SenderRole = 'client' | 'chef' | 'support';

export interface AttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

/** A message as a participant reads it. */
export interface MessageView {
  id: string;
  conversationId: string;
  /** Compare with the conversation's `viewerRole` to know whose message it is. */
  senderRole: SenderRole;
  body: string;
  /** A phone number or an email was replaced by `•••••` in `body`. */
  contactMasked: boolean;
  attachments: AttachmentView[];
  clientMessageId: string | null;
  createdAt: Date;
}

/** A message as an admin reads it: the text as written. */
export interface AdminMessageView extends Omit<MessageView, 'contactMasked'> {
  contactDetected: boolean;
  /** Who wrote it, for the team: a participant's name, or the admin who answered. */
  senderName: string | null;
}

export interface BookingSummary {
  id: string;
  reference: string | null;
  status: BookingStatus;
  startsAt: Date;
  endsAt: Date;
}

export interface CounterpartView {
  role: SenderRole;
  name: string;
  avatarUrl: string | null;
  /** Null until the contact details are released (J-2), and always for support. */
  phone: string | null;
}

/** What a batch cooker needs to know about the household they cook for. */
export interface ClientCardView {
  city: string | null;
  householdAdults: number;
  householdKids: number;
  allergies: string[];
  dietaryPreferences: string[];
  kitchenNotes: string | null;
}

export interface ConversationView {
  id: string;
  type: ConversationKind;
  /** The side the caller writes from: `client` or `chef`. */
  viewerRole: SenderRole;
  counterpart: CounterpartView;
  /** The prestation the thread is about right now. Null for support. */
  booking: BookingSummary | null;
  writable: boolean;
  contactReleased: boolean;
  /** Always null: contact details are never released. */
  contactReleaseAt: Date | null;
  lastMessage: MessageView | null;
  lastMessageAt: Date | null;
  unreadCount: number;
  createdAt: Date;
}

export interface ConversationDetailView extends ConversationView {
  /** Only for a batch cooker, on a client thread. */
  clientCard: ClientCardView | null;
}

export interface AdminPartyView {
  userId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

export interface AdminConversationView {
  id: string;
  type: ConversationKind;
  /** `chef_client` threads. */
  client: AdminPartyView | null;
  chef: (AdminPartyView & { chefProfileId: string }) | null;
  /** `support` threads: who is writing to the team, and from which space. */
  supportUser: (AdminPartyView & { role: SenderRole }) | null;
  booking: BookingSummary | null;
  contactReleased: boolean;
  contactFlaggedAt: Date | null;
  lastMessage: AdminMessageView | null;
  lastMessageAt: Date | null;
  /** Support threads only. */
  unreadCount: number;
  createdAt: Date;
}

export interface MessagePage<T> {
  /** Oldest first, ready to render. */
  data: T[];
  /** Pass as `before` to load the page above. Null at the top of the thread. */
  nextCursor: string | null;
}

/** What goes down the WebSocket. */
export type RealtimeEvent =
  | { event: 'message.created'; data: { conversationId: string; message: MessageView } }
  | {
      event: 'message.created';
      data: { conversationId: string; message: AdminMessageView };
    }
  | { event: 'conversation.updated'; data: { conversationId: string } };

/**
 * One thing that happened, with who must hear about it. Participants and admins
 * do not read the same text, hence two payloads.
 */
export interface RealtimeEnvelope {
  userIds: string[];
  toUsers: RealtimeEvent | null;
  toAdmins: RealtimeEvent | null;
}
