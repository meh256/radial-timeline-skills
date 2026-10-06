#!/usr/bin/env node
// data/<publicId>.b64 (the LR_B64 block saved from the export page) → data/<publicId>.json, validated
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const id = process.argv[2];
if (!id) { console.error('Usage: node scripts/decode.mjs <publicId>'); process.exit(1); }
const src = join(root, 'data', `${id}.b64`);
if (!existsSync(src)) { console.error(`Missing ${src}`); process.exit(1); }
const b64 = readFileSync(src, 'utf8').replace(/LR_B64_BEGIN|LR_B64_END/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
let data;
try { data = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); } catch (e) { console.error('Could not decode: the base64 block is incomplete or altered. Re-run __lr.export() and copy it again.'); process.exit(1); }
// repair known collector quirks in older runs: a duration ("5 yrs") stored as an employment type
for (const e of data.experience || []) for (const r of e.roles || []) if (r.type && /\d+\s*(yrs?|mos?)/.test(r.type)) r.type = null;
const roles = (data.experience || []).reduce((a, e) => a + (e.roles || []).length, 0);
if (data.missing?.length) console.warn('WARNING: missing parts:', data.missing.join(', '), '— run the collector on those pages and export again');
writeFileSync(join(root, 'data', `${id}.json`), JSON.stringify(data));
console.log(`wrote data/${id}.json — ${data.profile?.name || '(no name)'}, ${(data.experience || []).length} companies, ${roles} roles, ${(data.education || []).length} schools`);
