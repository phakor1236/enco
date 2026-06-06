import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringify } from 'yaml';

import { buildOpenApiDocument } from '../src/lib/openapi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outPath = path.resolve(__dirname, '../../../docs/api/openapi.yaml');
mkdirSync(path.dirname(outPath), { recursive: true });

const doc = buildOpenApiDocument();
writeFileSync(outPath, stringify(doc), 'utf-8');
// eslint-disable-next-line no-console
console.log(`[openapi] wrote ${outPath}`);
