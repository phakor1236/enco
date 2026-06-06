import { readFileSync } from 'node:fs';

import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/db.js';
import { buildOpenApiDocument } from '../../src/lib/openapi.js';

afterAll(async () => {
  await prisma.$disconnect();
});

const app = createApp();

describe('OpenAPI document', () => {
  it('declares all 4 auth endpoints', () => {
    const doc = buildOpenApiDocument();
    const paths = Object.keys(doc.paths ?? {});
    expect(paths).toContain('/api/auth/register');
    expect(paths).toContain('/api/auth/login');
    expect(paths).toContain('/api/auth/refresh');
    expect(paths).toContain('/api/auth/logout');
  });

  it('declares the 3 catalog endpoints (T2.4)', () => {
    const doc = buildOpenApiDocument();
    const paths = Object.keys(doc.paths ?? {});
    expect(paths).toContain('/api/categories');
    expect(paths).toContain('/api/products');
    expect(paths).toContain('/api/products/{slug}');

    const list = doc.paths?.['/api/products']?.get;
    expect(Object.keys(list?.responses ?? {})).toEqual(expect.arrayContaining(['200', '400']));
    const detail = doc.paths?.['/api/products/{slug}']?.get;
    expect(Object.keys(detail?.responses ?? {})).toEqual(expect.arrayContaining(['200', '404']));
  });

  it('lists realistic response codes per endpoint', () => {
    const doc = buildOpenApiDocument();
    const register = doc.paths?.['/api/auth/register']?.post;
    expect(Object.keys(register?.responses ?? {})).toEqual(
      expect.arrayContaining(['201', '400', '409', '429']),
    );
    const login = doc.paths?.['/api/auth/login']?.post;
    expect(Object.keys(login?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '400', '401', '429']),
    );
    const refresh = doc.paths?.['/api/auth/refresh']?.post;
    expect(Object.keys(refresh?.responses ?? {})).toEqual(
      expect.arrayContaining(['200', '401', '409', '429']),
    );
    const logout = doc.paths?.['/api/auth/logout']?.post;
    expect(Object.keys(logout?.responses ?? {})).toEqual(expect.arrayContaining(['204', '429']));
  });

  it('declares reusable component schemas', () => {
    const doc = buildOpenApiDocument();
    const schemas = doc.components?.schemas ?? {};
    expect(Object.keys(schemas)).toEqual(
      expect.arrayContaining([
        'ErrorResponse',
        'UserDto',
        'AuthSuccess',
        'RegisterBody',
        'LoginBody',
        'CategoryDto',
        'CategoryListResponse',
        'ProductImageDto',
        'VariantDto',
        'VariantOptionDto',
        'SkuDto',
        'ProductListItemDto',
        'ProductDetailDto',
        'ProductListResponse',
      ]),
    );
  });
});

describe('docs/api/openapi.yaml drift detection', () => {
  it('matches buildOpenApiDocument() output — run `pnpm openapi:generate` if this fails', () => {
    // Resolves to <repo-root>/docs/api/openapi.yaml from apps/api/tests/api/
    const yamlPath = new URL('../../../../docs/api/openapi.yaml', import.meta.url);
    const onDisk = readFileSync(yamlPath, 'utf-8');
    const expected = stringify(buildOpenApiDocument());
    expect(onDisk).toBe(expected);
  });
});

describe('GET /api/docs', () => {
  it('serves Swagger UI HTML in non-production', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toMatch(/swagger-ui/i);
  });

  it('exposes the OpenAPI document as JSON at /api/docs.json', async () => {
    const res = await request(app).get('/api/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('VELLA E-commerce API');
  });
});
