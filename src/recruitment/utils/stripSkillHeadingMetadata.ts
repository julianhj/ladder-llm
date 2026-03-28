/**
 * Remove internal assessment metadata accidentally pasted into skill **group headings**
 * (e.g. "Cloud practices (evidenced)"). Output CVs must read like a real resume, not pipeline notes.
 */

const TRAILING_META_PAREN = /\s*\(([^)]*)\)\s*$/i;

/** Words/phrases inside trailing parens that indicate internal metadata, not CV content. */
function parenLooksLikeMetadata(inner: string): boolean {
  const t = inner.trim().toLowerCase();
  if (t.length === 0 || t.length > 80) return false;
  const patterns = [
    /^evidenced$/,
    /^provisional$/,
    /^declared(?:\s+only)?$/,
    /^lower[-\s]confidence$/,
    /^unverified$/,
    /^needs\s+evidence$/,
    /^explicit\s+ramp[-\s]?up$/,
    /^ramp[-\s]?up$/,
    /^development\s+areas?$/,
    /^validation$/,
    /^internal$/,
    /\bevidenced\b/,
    /\bprovisional\b/,
    /\bdeclared\s+only\b/,
    /\blower\s+confidence\b/,
    /\bneeds\s+evidence\b/,
  ];
  return patterns.some((re) => re.test(t));
}

/**
 * Strip trailing parenthetical metadata from a skill category heading. Repeats until stable.
 * Does not remove geographic or domain qualifiers like "(UK)" unless they match metadata heuristics.
 */
export function stripSkillHeadingMetadata(heading: string): string {
  let h = String(heading ?? '').trim();
  if (!h) return h;
  let prev = '';
  while (h !== prev) {
    prev = h;
    const m = h.match(TRAILING_META_PAREN);
    if (!m) break;
    if (parenLooksLikeMetadata(m[1])) {
      h = h.slice(0, m.index).trim();
    } else {
      break;
    }
  }
  return h.trim() || String(heading ?? '').trim();
}
