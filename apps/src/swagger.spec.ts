import type { OpenAPIObject } from '@nestjs/swagger';

import { schemaOf, withSchemasFromExamples } from './swagger';

describe('schemas from examples', () => {
  it('reads the shape an example shows', () => {
    expect(
      schemaOf({ id: 'a', priceCents: 1500, active: true, reply: null, tags: ['x'] }),
    ).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        priceCents: { type: 'number' },
        active: { type: 'boolean' },
        reply: { nullable: true },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'priceCents', 'active', 'reply', 'tags'],
    });
  });

  it('fills a 2xx documented by an example only, and leaves a DTO schema alone', () => {
    const dto = { $ref: '#/components/schemas/BookingDto' };
    const document = {
      paths: {
        '/a': {
          get: {
            responses: {
              '200': { content: { 'application/json': { example: { n: 1 } } } },
              '404': { content: { 'application/json': { example: { code: 'X' } } } },
            },
          },
          post: {
            responses: { '201': { content: { 'application/json': { schema: dto } } } },
          },
        },
        '/b': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { examples: { one: { value: [true] } } } },
              },
            },
          },
        },
      },
    } as unknown as OpenAPIObject;

    type Paths = Record<
      string,
      Record<
        string,
        { responses: Record<string, { content: Record<string, { schema?: unknown }> }> }
      >
    >;
    const paths = withSchemasFromExamples(document).paths as unknown as Paths;
    const at = (path: string, method: string, status: string) =>
      paths[path][method].responses[status].content['application/json'].schema;

    expect(at('/a', 'get', '200')).toEqual({
      type: 'object',
      properties: { n: { type: 'number' } },
      required: ['n'],
      'x-schema-from-example': true,
    });
    expect(at('/a', 'get', '404')).toBeUndefined();
    expect(at('/a', 'post', '201')).toBe(dto);
    expect(at('/b', 'get', '200')).toMatchObject({
      type: 'array',
      items: { type: 'boolean' },
    });
  });
});
