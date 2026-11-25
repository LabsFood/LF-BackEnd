import { X509Certificate } from 'crypto';
import { getCACertificates, rootCertificates } from 'tls';

import { distrustCompromisedRoots, TRUSTED_ROOT_CERTIFICATES } from './trusted-roots';

const isEmSign = (pem: string): boolean =>
  /eMudhra|emSign/i.test(new X509Certificate(pem).subject);

describe('trusted-roots', () => {
  it('keeps every bundled root except the eMudhra (emSign) ones', () => {
    const emSign = rootCertificates.filter(isEmSign);
    expect(emSign.length).toBeGreaterThan(0);
    expect(TRUSTED_ROOT_CERTIFICATES.some(isEmSign)).toBe(false);
    expect(TRUSTED_ROOT_CERTIFICATES).toHaveLength(
      rootCertificates.length - emSign.length,
    );
  });

  it('makes them the default CAs of every later TLS connection', () => {
    expect(distrustCompromisedRoots()).toBe(rootCertificates.filter(isEmSign).length);
    const defaults = getCACertificates('default');
    expect(defaults.some(isEmSign)).toBe(false);
    expect(defaults).toHaveLength(TRUSTED_ROOT_CERTIFICATES.length);
  });
});
