import Fastify from 'fastify';

import { trustRailwayEdge } from './trusted-proxy';

const ipSeenBehind = async (forwardedFor: string): Promise<string> => {
  const app = Fastify({ trustProxy: trustRailwayEdge });
  app.get('/', async (req) => ({ ip: req.ip }));
  const res = await app.inject({
    url: '/',
    remoteAddress: '10.0.0.1', // Railway's edge
    headers: { 'x-forwarded-for': forwardedFor },
  });
  await app.close();
  return (res.json() as { ip: string }).ip;
};

describe('trustRailwayEdge', () => {
  it('reads the client address the edge appended', async () => {
    await expect(ipSeenBehind('203.0.113.9')).resolves.toBe('203.0.113.9');
  });

  it('ignores addresses a client wrote into X-Forwarded-For itself', async () => {
    await expect(ipSeenBehind('6.6.6.6, 7.7.7.7, 203.0.113.9')).resolves.toBe(
      '203.0.113.9',
    );
  });
});
