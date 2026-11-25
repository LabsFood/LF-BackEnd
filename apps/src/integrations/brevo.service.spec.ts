import { BrevoService, templateKeyOf } from './brevo.service';

const config = (values: Record<string, unknown>) =>
  ({ get: (key: string, fallback?: unknown) => values[key] ?? fallback }) as never;

describe('BrevoService template ids', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('maps a repo template name to its config key', () => {
    expect(templateKeyOf('BREVO_TPL_BOOKING_REQUEST_CHEF')).toBe('bookingRequestChef');
    expect(templateKeyOf('BREVO_TPL_NEW_MESSAGE')).toBe('newMessage');
    expect(templateKeyOf('Some campaign')).toBeNull();
  });

  it('finds the ids by name at startup; an env var still wins', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        templates: [
          { id: 41, name: 'BREVO_TPL_BOOKING_REQUEST_CHEF' },
          { id: 7, name: 'BREVO_TPL_NEW_MESSAGE' },
          { id: 99, name: 'Newsletter' },
        ],
      }),
    }) as never;
    const brevo = new BrevoService(
      config({ 'brevo.apiKey': 'k', 'brevo.templates': { newMessage: 3 } }),
    );
    await brevo.onModuleInit();
    expect(brevo.templates.bookingRequestChef).toBe(41);
    expect(brevo.templates.newMessage).toBe(3);
  });

  it('starts anyway when Brevo cannot be reached', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('down')) as never;
    const brevo = new BrevoService(
      config({ 'brevo.apiKey': 'k', 'brevo.templates': {} }),
    );
    await expect(brevo.onModuleInit()).resolves.toBeUndefined();
    expect(brevo.templates.bookingRequestChef).toBeUndefined();
  });

  it('asks nothing without an API key', async () => {
    global.fetch = jest.fn() as never;
    await new BrevoService(config({})).onModuleInit();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
