/**
 * Convert a list / education / certification / award row (string or object) to one display string.
 * Used by CV normalization and Zod transforms so object-shaped items validate and render.
 */
export function cvListItemToDisplayString(item: unknown): string {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'number' || typeof item === 'boolean') return String(item).trim();
  if (typeof item !== 'object' || Array.isArray(item)) return String(item).trim();
  const obj = item as Record<string, unknown>;

  const degree = typeof obj.degree === 'string' ? obj.degree.trim() : '';
  const institution = typeof obj.institution === 'string' ? obj.institution.trim() : '';
  if (degree || institution) return [degree, institution].filter(Boolean).join(' at ');

  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const organization = typeof obj.organization === 'string' ? obj.organization.trim() : '';
  if (title || organization) {
    const yearRaw = obj.year ?? obj.date;
    const year =
      yearRaw != null && (typeof yearRaw === 'string' || typeof yearRaw === 'number' || typeof yearRaw === 'boolean')
        ? String(yearRaw).trim()
        : '';
    const main = title && organization ? `${title} (${organization})` : title || organization;
    return year && main ? `${main} - ${year}` : main || year;
  }

  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  const issuer = typeof obj.issuer === 'string' ? obj.issuer.trim() : '';
  if (name || issuer) return name && issuer ? `${name} (${issuer})` : name || issuer;

  const award = typeof obj.award === 'string' ? obj.award.trim() : '';
  if (award) {
    const yearRaw = obj.year;
    const year =
      yearRaw != null && (typeof yearRaw === 'string' || typeof yearRaw === 'number' || typeof yearRaw === 'boolean')
        ? String(yearRaw).trim()
        : '';
    return year ? `${award} - ${year}` : award;
  }

  const parts = Object.values(obj)
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((s) => s.trim());
  return parts.join(' - ') || '';
}
