import type { StructuredCV } from '../schemas/StructuredInputs.js';

function pushBlock(lines: string[], text: string): void {
  const t = text.trim();
  if (t) lines.push(t);
}

function formatContact(header: NonNullable<StructuredCV['header']>): string[] {
  const out: string[] = [];
  const c = header.contact;
  if (!c || typeof c !== 'object') return out;
  if (c.email?.trim()) out.push(`Email: ${c.email.trim()}`);
  if (c.phone?.trim()) out.push(`Phone: ${c.phone.trim()}`);
  if (c.linkedin?.trim()) out.push(`LinkedIn: ${c.linkedin.trim()}`);
  if (c.location?.trim()) out.push(`Location: ${c.location.trim()}`);
  return out;
}

function richBlocksToLines(blocks: Array<{ type?: string; text?: string; ordered?: boolean; items?: string[] }>): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'paragraph' && typeof block.text === 'string') {
      pushBlock(lines, block.text);
    } else if (block.type === 'list' && Array.isArray(block.items)) {
      for (const item of block.items) {
        const s = String(item ?? '').trim();
        if (s) lines.push(`- ${s}`);
      }
    }
  }
  return lines;
}

/**
 * Deterministic plain-text CV for cv_extractor input (rerun from optimized_cv JSON).
 * Optional selected_missing_skills are appended with instructions so the extractor merges them into existing skill groups.
 */
export function structuredCvToProse(cv: StructuredCV, selectedMissingSkills?: string[] | null): string {
  const lines: string[] = [];

  const header = cv.header;
  if (header && typeof header === 'object') {
    if (header.full_name?.trim()) lines.push(header.full_name.trim());
    if (header.professional_title?.trim()) lines.push(header.professional_title.trim());
    lines.push(...formatContact(header));
  }

  const sections = Array.isArray(cv.sections) ? cv.sections : [];
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    const title = String((section as { section_title?: string }).section_title ?? 'Section').trim();
    const kind = String((section as { kind?: string }).kind ?? '').trim();
    const content = (section as { content?: unknown }).content;

    lines.push('');
    lines.push(title);
    lines.push('---');

    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      continue;
    }

    const c = content as Record<string, unknown>;

    switch (kind) {
      case 'summary': {
        if (typeof c.text === 'string') {
          pushBlock(lines, c.text);
        } else if (Array.isArray(c.blocks)) {
          lines.push(...richBlocksToLines(c.blocks as Array<{ type?: string; text?: string; items?: string[] }>));
        }
        break;
      }
      case 'skills': {
        if (Array.isArray(c.groups)) {
          for (const g of c.groups as Array<{ heading?: string; items?: string[]; narrative?: string }>) {
            if (!g || typeof g !== 'object') continue;
            const h = String(g.heading ?? '').trim();
            if (g.narrative?.trim()) {
              lines.push(h ? `${h}: ${g.narrative.trim()}` : g.narrative.trim());
            }
            if (Array.isArray(g.items)) {
              for (const item of g.items) {
                const s = String(item ?? '').trim();
                if (s) lines.push(`- ${s}`);
              }
            }
          }
        } else if (Array.isArray(c.categories)) {
          for (const cat of c.categories as Array<{ category_name?: string; skills?: string[] }>) {
            if (!cat || typeof cat !== 'object') continue;
            const name = String(cat.category_name ?? '').trim();
            if (name) lines.push(name);
            if (Array.isArray(cat.skills)) {
              for (const sk of cat.skills) {
                const s = String(sk ?? '').trim();
                if (s) lines.push(`- ${s}`);
              }
            }
          }
        } else if (Array.isArray(c.blocks)) {
          lines.push(...richBlocksToLines(c.blocks as Array<{ type?: string; text?: string; items?: string[] }>));
        }
        break;
      }
      case 'experience': {
        const items = Array.isArray(c.items) ? c.items : [];
        for (const item of items as Array<Record<string, unknown>>) {
          if (!item || typeof item !== 'object') continue;
          const company = String(item.company ?? '').trim();
          const position = String(item.position ?? item.role ?? '').trim();
          const when = String(item.duration ?? item.period ?? '').trim();
          const head = [position, company].filter(Boolean).join(' at ');
          const line1 = [head, when].filter(Boolean).join(' | ');
          if (line1) lines.push(line1);
          if (typeof item.description === 'string' && item.description.trim()) {
            pushBlock(lines, item.description);
          }
          if (Array.isArray(item.responsibilities)) {
            for (const r of item.responsibilities) {
              const s = String(r ?? '').trim();
              if (s) lines.push(`- ${s}`);
            }
          }
          if (Array.isArray(item.highlights)) {
            for (const h of item.highlights) {
              const s = String(h ?? '').trim();
              if (s) lines.push(`- ${s}`);
            }
          }
          lines.push('');
        }
        break;
      }
      case 'education': {
        const items = Array.isArray(c.items) ? c.items : [];
        for (const item of items as Array<{ degree?: string; institution?: string }>) {
          if (!item || typeof item !== 'object') continue;
          const degree = String(item.degree ?? '').trim();
          const inst = String(item.institution ?? '').trim();
          const row = [degree, inst].filter(Boolean).join(' — ');
          if (row) lines.push(`- ${row}`);
        }
        break;
      }
      case 'list': {
        if (Array.isArray(c.items)) {
          for (const item of c.items) {
            const s = String(item ?? '').trim();
            if (s) lines.push(`- ${s}`);
          }
        }
        break;
      }
      case 'rich_text': {
        if (Array.isArray(c.blocks)) {
          lines.push(...richBlocksToLines(c.blocks as Array<{ type?: string; text?: string; items?: string[] }>));
        }
        break;
      }
      case 'custom':
      default: {
        try {
          const serialized = JSON.stringify(c);
          if (serialized && serialized !== '{}') lines.push(serialized);
        } catch {
          lines.push(String(content));
        }
        break;
      }
    }
  }

  const selected =
    selectedMissingSkills?.map((s) => String(s ?? '').trim()).filter((s) => s.length > 0) ?? [];
  if (selected.length > 0) {
    lines.push('');
    lines.push('---');
    lines.push(
      'Additional skill tokens (for each token, first check if an existing Skills group above is suitable and add it there; only create a new group if no existing group fits; do not add development-area sections or ramp-up categories):'
    );
    for (const s of selected) {
      lines.push(`- ${s}`);
    }
  }

  return lines.join('\n').trim();
}
