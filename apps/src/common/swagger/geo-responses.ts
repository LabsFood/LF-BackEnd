import { applyDecorators } from '@nestjs/common';
import { ApiBadGatewayResponse, ApiGatewayTimeoutResponse } from '@nestjs/swagger';

const FAILED =
  '`GEO_UNAVAILABLE`: geo.api.gouv.fr, the official commune base the address is ' +
  'checked against, failed — not this API. `upstream` names it, `reason` says how. ' +
  'Nothing was saved: try again in a moment.';

/** A route that checks an address against geo.api.gouv.fr can fail because of it. */
export function ApiGeoResponses(): MethodDecorator {
  return applyDecorators(
    ApiBadGatewayResponse({
      description:
        `${FAILED} \`reason\`: \`unreachable\`, \`http-error\` (with its ` +
        '`upstreamStatus`) or `invalid-response`.',
      example: {
        code: 'GEO_UNAVAILABLE',
        message:
          'geo.api.gouv.fr, the official commune base, answered with an error: the ' +
          'address could not be checked and nothing was saved. Try again in a moment.',
        upstream: 'geo.api.gouv.fr',
        reason: 'http-error',
        upstreamStatus: 500,
      },
    }),
    ApiGatewayTimeoutResponse({
      description: `${FAILED} \`reason\`: \`timeout\`, no answer within 5 s.`,
    }),
  );
}
