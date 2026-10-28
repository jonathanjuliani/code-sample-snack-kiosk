import type { ApiError } from '@kiosk/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

export function issuesFrom(error: z.ZodError): NonNullable<ApiError['issues']> {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function sendInvalid(
  request: FastifyRequest,
  reply: FastifyReply,
  issues: NonNullable<ApiError['issues']>,
): FastifyReply {
  const body: ApiError = {
    error: 'invalid_request',
    message: 'The request is not valid.',
    issues,
    requestId: request.id,
  };
  return reply.status(400).send(body);
}
