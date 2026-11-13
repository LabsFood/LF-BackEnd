/**
 * Fastify `trustProxy`: trust exactly one hop, Railway's edge, so `req.ip` is the
 * address the edge saw (the last X-Forwarded-For entry) and a client can't choose
 * its own rate-limit bucket by sending X-Forwarded-For itself.
 *
 * A function, not `1`: since Fastify 5.12 a hop count trusts nothing, which would
 * put every user behind the edge's IP in one bucket. The container has no public
 * port, so the immediate peer is always the edge. Putting another proxy in front
 * (a Cloudflare-proxied domain, say) means trusting `hop <= 1`.
 */
export const trustRailwayEdge = (_address: string, hop: number): boolean => hop === 0;
