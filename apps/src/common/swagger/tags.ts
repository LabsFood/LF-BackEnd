/**
 * Swagger sections, in the order Swagger UI shows them: the path a person takes
 * through the product first, then the back office. Controllers tag their routes
 * from here, so a typo cannot open a stray section at the bottom of the page.
 */
export const TAGS = {
  health: 'Health',
  signUp: 'Sign-up',
  me: 'My account',
  referentials: 'Reference lists',
  candidature: 'Batch cooker — candidature',
  documents: 'Batch cooker — documents',
  chefContent: 'Batch cooker — dishes and menus',
  catalog: 'Catalog',
  bookings: 'Bookings',
  payments: 'Payments',
  missions: 'Prestations — recipe sheet and shopping list',
  quotes: 'Quotes',
  messaging: 'Messaging',
  contact: 'Contact forms',
  dashboards: 'Dashboards',
  adminUsers: 'Admin — users and clients',
  adminChefs: 'Admin — batch cookers',
  adminContent: 'Admin — dishes and menus',
  adminCatalog: 'Admin — catalog',
  adminBookings: 'Admin — bookings',
  adminQuotes: 'Admin — quotes',
  adminMessaging: 'Admin — messaging',
  adminContact: 'Admin — contact inbox',
  adminDashboard: 'Admin — dashboard',
} as const;

/** One line under each section title. */
export const TAG_DESCRIPTIONS: Record<keyof typeof TAGS, string> = {
  health: 'Is the API up, and can it reach the database? For uptime checks and deploys.',
  signUp:
    'Create a client account. Batch cookers get their account by submitting a candidature.',
  me: 'The signed-in person: who they are, which space to open, and their profile.',
  referentials:
    'Fixed lists the forms need, such as the regions a batch cooker can cover.',
  candidature:
    'Become a batch cooker: apply, follow the application, apply again after a refusal.',
  documents:
    "A batch cooker's identity and business papers: upload, follow the review, renew.",
  chefContent:
    'A batch cooker writes dishes with their recipe, composes menus and publishes ' +
    'them. Public at once; admins check afterwards.',
  catalog:
    'What clients can order: the week’s cooks and their menus, each cook’s page. ' +
    'Public.',
  bookings: "The signed-in client's bookings.",
  missions:
    'The documents a prestation leaves: the recipe sheet of each dish and the ' +
    'shopping list, from the recipe versions it cooks from.',
  quotes: 'Custom quote requests, for events or larger orders.',
  payments:
    'Paying a prestation: card, prefinanced CESU and URSSAF immediate advance. ' +
    'Also the batch cooker’s payout account, the commission invoices collected by ' +
    'SEPA direct debit, and the fiscal data of services à la personne.',
  messaging:
    'Conversations of the signed-in client or batch cooker: one per client and cook, ' +
    'plus one with the Lab’s Food team. New messages are pushed over the `/ws` WebSocket.',
  dashboards: 'Summaries for the signed-in client.',
  adminUsers:
    'Create accounts, change roles, manage client profiles and batch cooker flags. Admins only.',
  adminChefs: 'Review candidatures and documents, then approve or refuse. Admins only.',
  adminContent:
    'Batch cookers publish directly; admins look afterwards: the review queue, one-click ' +
    'review, taking content down with a reason. Admins only.',
  adminCatalog: 'Meals, weekly menus and pricing formules. Admins only.',
  adminBookings: 'Any booking and its shopping list. Admins only.',
  adminQuotes: 'Price and follow up quote requests. Admins only.',
  contact:
    'The contact forms of the public sites. No account needed: the message lands in ' +
    'the admin inbox.',
  adminMessaging:
    'The support inbox, and every client and cook conversation for moderation. ' +
    'Admins only.',
  adminDashboard: 'Figures for the back office. Admins only.',
  adminContact:
    'Read, answer by email and archive what the contact forms receive. Admins only.',
};
