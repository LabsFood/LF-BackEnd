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
  catalog: 'Catalog',
  bookings: 'Bookings',
  quotes: 'Quotes',
  dashboards: 'Dashboards',
  adminUsers: 'Admin — users and clients',
  adminChefs: 'Admin — batch cookers',
  adminCatalog: 'Admin — catalog',
  adminBookings: 'Admin — bookings',
  adminQuotes: 'Admin — quotes',
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
  catalog: 'What clients can order.',
  bookings: "The signed-in client's bookings.",
  quotes: 'Custom quote requests, for events or larger orders.',
  dashboards: 'Summaries for the signed-in client.',
  adminUsers:
    'Create accounts, change roles, manage client profiles and batch cooker flags. Admins only.',
  adminChefs: 'Review candidatures and documents, then approve or refuse. Admins only.',
  adminCatalog: 'Meals, weekly menus and pricing formules. Admins only.',
  adminBookings: 'Any booking and its shopping list. Admins only.',
  adminQuotes: 'Price and follow up quote requests. Admins only.',
  adminDashboard: 'Figures for the back office. Admins only.',
};
