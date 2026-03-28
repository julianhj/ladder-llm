/**
 * One-off: build example-assessment-display-response.json from a saved full recruitment response.
 * Usage: npx tsx scripts/generate-example-assessment-display.ts [path-to-recruitment-response.json]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildAssessmentDisplayDocument } from '../src/assessmentDisplayPayload.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const defaultInput = path.join(
  repoRoot,
  'packages/api-server/outputs/recruitment-response-2026-03-17T18-50-31-393Z.json'
);
const inputPath = process.argv[2] ?? defaultInput;
const outDir = path.join(repoRoot, 'packages/api-server/docs');
const outputPath = path.join(outDir, 'example-assessment-display-response.json');

const raw = readFileSync(inputPath, 'utf-8');
const response = JSON.parse(raw) as Parameters<typeof buildAssessmentDisplayDocument>[0];
const id = response.metadata?.correlationToken ?? 'example-assessment-id';
const doc = buildAssessmentDisplayDocument(response, {
  assessmentId: id,
  savedAt: '2026-03-17T18:50:31.392Z',
});
mkdirSync(outDir, { recursive: true });
writeFileSync(outputPath, JSON.stringify(doc, null, 2), 'utf-8');
console.log('Wrote', outputPath);
