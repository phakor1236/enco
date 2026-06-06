import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { LoginBody, RegisterBody } from '@app/shared';

extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  })
  .openapi('ErrorResponse');

const UserDto = z
  .object({
    id: z.string(),
    email: z.string().email(),
    role: z.enum(['CUSTOMER', 'ADMIN', 'SUPER_ADMIN']),
  })
  .openapi('UserDto');

const AuthSuccess = z
  .object({
    user: UserDto,
    accessToken: z.string().describe('JWT access token, 15 min TTL — store in memory only'),
  })
  .openapi('AuthSuccess');

const RegisterBodyOpen = RegisterBody.openapi('RegisterBody');
const LoginBodyOpen = LoginBody.openapi('LoginBody');

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV3['generateDocument']> {
  const registry = new OpenAPIRegistry();

  registry.register('ErrorResponse', ErrorResponse);
  registry.register('UserDto', UserDto);
  registry.register('AuthSuccess', AuthSuccess);
  registry.register('RegisterBody', RegisterBodyOpen);
  registry.register('LoginBody', LoginBodyOpen);

  const errorResponse = (description: string) => ({
    description,
    content: { 'application/json': { schema: ErrorResponse } },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/register',
    tags: ['Auth'],
    summary: 'Register a new customer + auto-login',
    request: { body: { content: { 'application/json': { schema: RegisterBodyOpen } } } },
    responses: {
      201: {
        description: 'User created + access token issued + refresh cookie set',
        headers: {
          'Set-Cookie': {
            description: 'HttpOnly refresh cookie (vella_refresh)',
            schema: { type: 'string' },
          },
        },
        content: { 'application/json': { schema: AuthSuccess } },
      },
      400: errorResponse('VALIDATION_ERROR'),
      409: errorResponse('EMAIL_TAKEN'),
      429: errorResponse('RATE_LIMITED (3 registers / day / IP)'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/login',
    tags: ['Auth'],
    summary: 'Authenticate with email + password',
    request: { body: { content: { 'application/json': { schema: LoginBodyOpen } } } },
    responses: {
      200: {
        description: 'Access token issued + refresh cookie set',
        content: { 'application/json': { schema: AuthSuccess } },
      },
      400: errorResponse('VALIDATION_ERROR'),
      401: errorResponse('INVALID_CREDENTIALS'),
      429: errorResponse('RATE_LIMITED (5 logins / minute / IP)'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/refresh',
    tags: ['Auth'],
    summary: 'Rotate the refresh cookie + issue a fresh access token',
    description:
      'Reads vella_refresh cookie. On success the response Set-Cookie carries a new refresh ' +
      'value and the old one is revoked. Reuse of a stale token revokes the entire family.',
    responses: {
      200: { description: 'Rotated', content: { 'application/json': { schema: AuthSuccess } } },
      401: errorResponse('INVALID_TOKEN / TOKEN_EXPIRED / TOKEN_REUSED'),
      409: errorResponse('TOKEN_RACED (concurrent rotation)'),
      429: errorResponse('RATE_LIMITED'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/auth/logout',
    tags: ['Auth'],
    summary: 'Revoke the current refresh token + clear cookie',
    description: 'Idempotent. Returns 204 even when no refresh cookie was sent.',
    responses: {
      204: { description: 'Logged out (or already logged out)' },
      429: errorResponse('RATE_LIMITED'),
    },
  });

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'VELLA E-commerce API',
      version: '0.1.0',
      description:
        'B2C single-seller e-commerce platform. Phase 1 covers authentication; ' +
        'catalog, cart, checkout, orders and admin are added in later slices.',
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local dev' }],
    tags: [{ name: 'Auth', description: 'Registration + session management' }],
  });
}
