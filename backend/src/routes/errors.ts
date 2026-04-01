// ─── Shared Error Response Helper ──────────────────────────────
// All API error responses use this helper to guarantee a consistent
// shape: { error: string, statusCode: number }.

import type { FastifyReply } from 'fastify';

/**
 * Send a JSON error response with a consistent `{ error, statusCode }` shape.
 *
 * Usage:
 *   sendError(reply, 400, 'Invalid ID');
 *   sendError(reply, 404, 'Resource not found');
 */
export function sendError(
  reply: FastifyReply,
  statusCode: number,
  message: string,
): void {
  reply.status(statusCode).send({ error: message, statusCode });
}
