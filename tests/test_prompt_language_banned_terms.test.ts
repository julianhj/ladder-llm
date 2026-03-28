/**
 * Operational prompts must not reintroduce assessment jargon that models echo into outputs.
 * Archived copies live under prompts/old/ and are excluded.
 * See docs/PROMPT_LANGUAGE.md.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const PROMPTS_ROOT = join(__dirname, '../prompts');

const BANNED: Array<{ name: string; re: RegExp }> = [
  { name: 'two-tier', re: /two-tier/i },
  { name: 'provisional positives', re: /provisional\s+positives/i },
  { name: 'lower confidence', re: /lower\s*[- ]?\s*confidence/i },
  { name: 'declared-but-undemonstrated', re: /declared-but-undemonstrated/i },
];

function isUnderOldDir(absPath: string): boolean {
  const rel = relative(PROMPTS_ROOT, absPath);
  return rel.startsWith(`old${sep}`) || rel.split(sep).includes('old');
}

function listYamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (isUnderOldDir(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...listYamlFiles(p));
    } else if (name.endsWith('.yaml') || name.endsWith('.yml')) {
      out.push(p);
    }
  }
  return out;
}

describe('prompt language (no assessment jargon in operational YAML)', () => {
  it('has no banned phrases under prompts/ (excluding prompts/old)', () => {
    const files = listYamlFiles(PROMPTS_ROOT);
    expect(files.length).toBeGreaterThan(10);
    const violations: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      for (const { name, re } of BANNED) {
        if (re.test(text)) {
          violations.push(`${relative(PROMPTS_ROOT, file)}: matches ${name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
