/**
 * One-off script: convert all .md prompt files to .yaml with metadata and plain-text prompt body.
 * Strips markdown formatting from prompt bodies.
 * Run from packages/openai: npx tsx scripts/convert_prompts_to_yaml.ts
 */

import { readFile, writeFile, readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.resolve(__dirname, '../prompts');

const SKIP_NAMES = new Set(['README.md', 'VERSIONING.md', 'prompt_authoring_standards.md']);
const SKIP_PREFIX = path.join(PROMPTS_DIR, 'old');

function stripMarkdown(text: string): string {
  let out = text;
  // Remove HTML comment block at start (metadata)
  out = out.replace(/^<!--\s*\n[\s\S]*?\n-->\s*\n?/, '');
  // Headings: # ## ### -> plain line
  out = out.replace(/^#{1,6}\s+/gm, '');
  // **bold** or __bold__
  out = out.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  // *italic* or _italic_ (single, not mid-word)
  out = out.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1').replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1');
  // `code`
  out = out.replace(/`([^`]+)`/g, '$1');
  // Fenced code blocks: keep content only
  out = out.replace(/```[\w]*\n?([\s\S]*?)```/g, '$1');
  // List items: "- item" or "* item" -> "item"
  out = out.replace(/^\s*[-*]\s+/gm, '');
  // Numbered list: "1. item" -> "item"
  out = out.replace(/^\s*\d+\.\s+/gm, '');
  // [link](url) -> link
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  // Collapse 3+ newlines to 2
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function extractMetadata(content: string): { version: string; lastModified: string; description: string; body: string } {
  const metadataMatch = content.match(/^<!--\s*\n([\s\S]*?)\n-->/);
  let version = '';
  let lastModified = '';
  let description = '';
  let body: string;

  if (metadataMatch) {
    const block = metadataMatch[1];
    const v = block.match(/version:\s*(.+)/i);
    const lm = block.match(/lastModified:\s*(.+)/i);
    const d = block.match(/description:\s*(.+)/i);
    if (v) version = v[1].trim();
    if (lm) lastModified = lm[1].trim();
    if (d) description = d[1].trim();
    body = content.slice(metadataMatch[0].length).trim();
  } else {
    body = content.trim();
  }

  return { version, lastModified, description, body };
}

function versionFromFilename(filename: string): string | null {
  const m = filename.match(/\.v(\d+\.\d+\.\d+)\.md$/);
  return m ? m[1] : null;
}

async function findMdFiles(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!full.startsWith(SKIP_PREFIX)) await findMdFiles(full, acc);
    } else if (e.isFile() && e.name.endsWith('.md') && !SKIP_NAMES.has(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function toYamlPath(mdPath: string): string {
  return mdPath.replace(/\.md$/, '.yaml');
}

function escapeYamlString(s: string): string {
  if (s.includes('\n') || s.includes(':') || s.includes('"') || s.includes("'")) {
    return s.split('\n').map(line => '  ' + line.replace(/\\/g, '\\\\').replace(/"/g, '\\"')).join('\n');
  }
  return s;
}

async function main() {
  const mdFiles = await findMdFiles(PROMPTS_DIR);
  console.log(`Found ${mdFiles.length} .md prompt files to convert.`);

  for (const mdPath of mdFiles) {
    const content = await readFile(mdPath, 'utf-8');
    const { version: metaVersion, lastModified, description, body } = extractMetadata(content);
    const filename = path.basename(mdPath);
    const versionFromFile = versionFromFilename(filename);
    const version = metaVersion || versionFromFile || '';
    const promptBody = stripMarkdown(body);

    const yaml: string[] = [];
    if (version) yaml.push(`version: "${version}"`);
    if (lastModified) yaml.push(`lastModified: "${lastModified}"`);
    if (description) yaml.push(`description: "${description.replace(/"/g, '\\"')}"`);
    yaml.push('prompt: |');
    for (const line of promptBody.split('\n')) {
      yaml.push('  ' + line);
    }

    const yamlPath = toYamlPath(mdPath);
    await writeFile(yamlPath, yaml.join('\n'), 'utf-8');
    console.log(`Wrote ${path.relative(PROMPTS_DIR, yamlPath)}`);
  }

  console.log('Done. Remove .md files manually or with: find prompts -name "*.md" ! -name "README.md" ! -name "VERSIONING.md" ! -name "prompt_authoring_standards.md" ! -path "*/old/*" -delete');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
