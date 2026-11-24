import { fetchPublicPage, UnsafeUrlError } from './safe-fetch';

const page = (body: string) =>
  Promise.resolve({ status: 200, contentType: 'text/html', body });

describe('fetchPublicPage', () => {
  it('lit une page publique', async () => {
    await expect(
      fetchPublicPage(
        'https://example.com/r',
        () => Promise.resolve(['93.184.216.34']),
        () => page('<p>ok</p>'),
      ),
    ).resolves.toBe('<p>ok</p>');
  });

  it('refuse un nom qui résout vers une adresse interne', async () => {
    await expect(
      fetchPublicPage(
        'https://evil.example.com/',
        () => Promise.resolve(['93.184.216.34', '10.0.0.5']),
        () => page(''),
      ),
    ).rejects.toThrow('interne');
  });

  it('revérifie chaque redirection, vers une IP interne ou en http', async () => {
    const resolve = (host: string) =>
      Promise.resolve([host === 'example.com' ? '93.184.216.34' : host]);
    const redirectTo = (location: string) => () =>
      Promise.resolve({ status: 302, location, contentType: '', body: '' });
    await expect(
      fetchPublicPage(
        'https://example.com/',
        resolve,
        redirectTo('https://169.254.169.254/latest'),
      ),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(
      fetchPublicPage('https://example.com/', resolve, redirectTo('http://example.com/')),
    ).rejects.toThrow('https');
  });

  it('s’arrête après trop de redirections et refuse ce qui n’est pas une page', async () => {
    const resolve = () => Promise.resolve(['93.184.216.34']);
    await expect(
      fetchPublicPage('https://example.com/', resolve, () =>
        Promise.resolve({ status: 301, location: '/again', contentType: '', body: '' }),
      ),
    ).rejects.toThrow('redirections');
    await expect(
      fetchPublicPage('https://example.com/', resolve, () =>
        Promise.resolve({ status: 200, contentType: 'application/pdf', body: '' }),
      ),
    ).rejects.toThrow("n'est pas une page");
  });
});
