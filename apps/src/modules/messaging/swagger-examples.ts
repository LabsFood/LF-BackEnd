/** Example payloads for the messaging routes, shown in Swagger UI. */

export const CONVERSATION_ID = 'd3eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';

export const MESSAGE_EXAMPLE = {
  id: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
  conversationId: CONVERSATION_ID,
  senderRole: 'client',
  body: 'Bonjour ! Vous pouvez m’appeler au ••••• si besoin.',
  contactMasked: true,
  attachments: [
    {
      id: 'e4eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
      fileName: 'plan-cuisine.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 842133,
    },
  ],
  clientMessageId: '3f6c2a1e-8f0b-4c53-9a44-1c2d5e7f9b10',
  createdAt: '2026-10-06T08:30:00.000Z',
};

export const CONVERSATION_EXAMPLE = {
  id: CONVERSATION_ID,
  type: 'chef_client',
  viewerRole: 'chef',
  counterpart: { role: 'client', name: 'Sophie M.', avatarUrl: null, phone: null },
  booking: {
    id: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    reference: 'LF-2026-0142',
    status: 'confirmed',
    startsAt: '2026-10-15T07:00:00.000Z',
    endsAt: '2026-10-15T11:00:00.000Z',
  },
  writable: true,
  contactReleased: false,
  contactReleaseAt: '2026-10-13T07:00:00.000Z',
  lastMessage: MESSAGE_EXAMPLE,
  lastMessageAt: '2026-10-06T08:30:00.000Z',
  unreadCount: 1,
  createdAt: '2026-10-01T09:12:00.000Z',
};

export const CONVERSATION_DETAIL_EXAMPLE = {
  ...CONVERSATION_EXAMPLE,
  clientCard: {
    city: 'Nice',
    householdAdults: 2,
    householdKids: 1,
    allergies: ['gluten'],
    dietaryPreferences: ['végétarien'],
    kitchenNotes: 'Four à chaleur tournante, pas de robot.',
  },
};

export const MESSAGE_PAGE_EXAMPLE = {
  data: [MESSAGE_EXAMPLE],
  nextCursor: null,
};

export const ATTACHMENT_UPLOAD_EXAMPLE = {
  uploadId: 'up_9f2a1c4e7b30d85a61c2e4f7',
  method: 'PUT',
  url: 'https://<project>.supabase.co/storage/v1/object/upload/sign/labsfood-messages/conversations/d3ee…/a0ee…/up_9f2a…?token=eyJhbGciOi…',
  headers: { 'Content-Type': 'image/jpeg' },
  expiresAt: '2026-10-06T10:30:00.000Z',
};

export const ATTACHMENT_DOWNLOAD_EXAMPLE = {
  url: 'https://<project>.supabase.co/storage/v1/object/sign/labsfood-messages/conversations/d3ee…/a0ee…/up_9f2a…?token=eyJhbGciOi…',
  expiresAt: '2026-10-06T08:35:00.000Z',
};

export const ADMIN_MESSAGE_EXAMPLE = {
  id: MESSAGE_EXAMPLE.id,
  conversationId: CONVERSATION_ID,
  senderRole: 'client',
  body: 'Bonjour ! Vous pouvez m’appeler au 06 12 34 56 78 si besoin.',
  contactDetected: true,
  senderName: 'Sophie Marchand',
  attachments: MESSAGE_EXAMPLE.attachments,
  clientMessageId: MESSAGE_EXAMPLE.clientMessageId,
  createdAt: MESSAGE_EXAMPLE.createdAt,
};

export const ADMIN_CONVERSATION_EXAMPLE = {
  id: CONVERSATION_ID,
  type: 'chef_client',
  client: {
    userId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    name: 'Sophie Marchand',
    email: 'sophie.marchand@exemple.fr',
    avatarUrl: null,
  },
  chef: {
    userId: 'f5eebc99-9c0b-4ef8-bb6d-6bb9bd380a66',
    name: 'Marie Dupont',
    email: 'marie.dupont@exemple.fr',
    avatarUrl: null,
    chefProfileId: 'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380abc',
  },
  supportUser: null,
  booking: CONVERSATION_EXAMPLE.booking,
  contactReleased: false,
  contactFlaggedAt: '2026-10-06T08:30:00.000Z',
  lastMessage: ADMIN_MESSAGE_EXAMPLE,
  lastMessageAt: '2026-10-06T08:30:00.000Z',
  unreadCount: 0,
  createdAt: '2026-10-01T09:12:00.000Z',
};

export const errorExample = (code: string, message: string) => ({ code, message });

export const MASKING_HELP =
  'While the contact details are not released, a phone number or an email in a ' +
  'message is served as `•••••` and `contactMasked` is true. They are released from ' +
  '48 hours before a confirmed prestation until it ends (`contactReleased`).';

export const WEBSOCKET_HELP =
  'New messages are pushed over the `/ws` WebSocket. After connecting, send ' +
  '`{"event":"auth","data":{"token":"<Clerk session token>"}}` and wait for ' +
  '`{"event":"ready"}`. The server then sends `message.created` ' +
  '(`{ conversationId, message }`) and `conversation.updated` (`{ conversationId }`). ' +
  'Nothing is sent through the socket: post with the REST route.';
