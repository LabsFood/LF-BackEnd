import { R2Config, R2StorageService, detectImageType } from './r2-storage.service';

const CONFIG: R2Config = {
  accountId: 'acc123',
  accessKeyId: 'AKIAEXAMPLE',
  secretAccessKey: 'secret',
  bucket: 'labsfood-photos',
  publicBaseUrl: 'https://photos.labsfood.fr/',
};

const configured = () =>
  new R2StorageService({ get: () => CONFIG } as unknown as ConstructorParameters<
    typeof R2StorageService
  >[0]);

/** Replaces the S3 client's `send` so no request ever leaves the test. */
const withSend = (storage: R2StorageService, send: jest.Mock) => {
  (storage as unknown as { client: { send: jest.Mock } }).client.send = send;
  return storage;
};

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by their first bytes', () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      detectImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe('image/png');
    expect(detectImageType(Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'latin1'))).toBe(
      'image/webp',
    );
  });

  it('refuses anything else, such as HTML sent as a JPEG', () => {
    expect(detectImageType(Buffer.from('<html><script>'))).toBeNull();
    expect(detectImageType(Buffer.from([]))).toBeNull();
  });
});

describe('R2StorageService', () => {
  it('signs the upload for this key, type and exact length, offline', async () => {
    const { url, headers } = await configured().createUploadUrl(
      'chefs/c1/dishes/d1/ph_x.jpg',
      'image/jpeg',
      480000,
    );
    const signed = new URL(url);
    expect(signed.host).toBe('labsfood-photos.acc123.eu.r2.cloudflarestorage.com');
    expect(signed.pathname).toBe('/chefs/c1/dishes/d1/ph_x.jpg');
    expect(signed.searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-length;content-type;host',
    );
    expect(headers).toEqual({ 'Content-Type': 'image/jpeg' });
  });

  it('turns a key into its public address and back, and ignores other URLs', () => {
    const storage = configured();
    const url = storage.publicUrl('chefs/c1/dishes/d1/ph_x.jpg');
    expect(url).toBe('https://photos.labsfood.fr/chefs/c1/dishes/d1/ph_x.jpg');
    expect(storage.keyOf(url)).toBe('chefs/c1/dishes/d1/ph_x.jpg');
    expect(storage.keyOf('https://elsewhere.example/chefs/c1/x.jpg')).toBeNull();
    expect(storage.keyOf(null)).toBeNull();
  });

  it('reads a missing object as "not uploaded", and lets any other failure through', async () => {
    const missing = Object.assign(new Error('NotFound'), {
      $metadata: { httpStatusCode: 404 },
    });
    const outage = Object.assign(new Error('Boom'), {
      $metadata: { httpStatusCode: 500 },
    });

    await expect(
      withSend(configured(), jest.fn().mockRejectedValue(missing)).head('k'),
    ).resolves.toBeNull();
    await expect(
      withSend(configured(), jest.fn().mockRejectedValue(outage)).head('k'),
    ).rejects.toBe(outage);
    await expect(
      withSend(
        configured(),
        jest.fn().mockResolvedValue({ ContentLength: 12, ContentType: 'image/png' }),
      ).head('k'),
    ).resolves.toEqual({ sizeBytes: 12, contentType: 'image/png' });
  });
});
