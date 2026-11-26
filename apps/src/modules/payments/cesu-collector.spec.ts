import { cesuCollector, DEFAULT_CESU_PLATFORM_NAME } from './cesu-collector';

describe('cesuCollector', () => {
  it('returns null when no platform NAN is configured: CESU is not offered', () => {
    expect(cesuCollector({})).toBeNull();
    expect(cesuCollector({ CESU_PLATFORM_NAN: '   ' })).toBeNull();
  });

  it('returns the platform NAN, with the SAP structure as the default payee', () => {
    expect(cesuCollector({ CESU_PLATFORM_NAN: ' 7654321 ' })).toEqual({
      nan: '7654321',
      name: DEFAULT_CESU_PLATFORM_NAME,
    });
  });

  it('uses the configured payee name when there is one', () => {
    expect(
      cesuCollector({ CESU_PLATFORM_NAN: '7654321', CESU_PLATFORM_NAME: 'Filiale SAP' }),
    ).toEqual({ nan: '7654321', name: 'Filiale SAP' });
  });
});
