import type { OutputSchemaName } from '../schemaRegistry.js';
import { SIGNAL_AGGREGATED_KEYS } from '../schemas/index.js';
import type { RichTextBlock, RichTextContent } from '../schemas/index.js';
import {
  dedupeSectionTitleRecommendations,
  normalizeSkillsFormattedRecord,
  type SectionTitleRecommendationInput,
} from '../../utils/normalizeFormattedSkillsOutput.js';

const ORDERED_LIST_MARKER = /^\s*(?:\((\d+)\)|(\d+)[.)])\s+(.*)$/;
const BULLET_LIST_MARKER = /^\s*[-*•]\s+(.*)$/;
const INLINE_ORDERED_MARKER = /(?:\((\d+)\)|(\d+)[.)])\s+/g;

function capitalizeFirstLetter(text: string): string {
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (/[a-zA-Z]/.test(ch)) {
      chars[i] = ch.toUpperCase();
      return chars.join('');
    }
  }
  return text;
}

function parseInlineOrderedList(text: string): RichTextBlock[] | null {
  const source = text.trim();
  const matches = Array.from(source.matchAll(INLINE_ORDERED_MARKER));
  if (matches.length < 2) return null;

  const firstIndex = matches[0].index ?? -1;
  if (firstIndex < 0) return null;

  const prefix = source.slice(0, firstIndex).trim().replace(/[;:\-]+$/, '').trim();
  const items: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const marker = matches[i];
    const start = (marker.index ?? 0) + marker[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length;
    const raw = source.slice(start, end).trim();
    const cleaned = raw.replace(/^;\s*/, '').replace(/^\band\b\s+/i, '').replace(/;\s*$/, '').trim();
    if (cleaned) items.push(capitalizeFirstLetter(cleaned));
  }
  if (items.length < 2) return null;

  const blocks: RichTextBlock[] = [];
  if (prefix) blocks.push({ type: 'paragraph', text: prefix });
  blocks.push({ type: 'list', ordered: true, items });
  return blocks;
}

export function parseListLikeRichTextBlocks(text: string): RichTextBlock[] | null {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: RichTextBlock[] = [];
  let paragraphLines: string[] = [];
  let hasListBlock = false;

  const flushParagraph = () => {
    const paragraph = paragraphLines.join('\n').trim();
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph });
    }
    paragraphLines = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const ordered = line.match(ORDERED_LIST_MARKER);
    if (ordered) {
      hasListBlock = true;
      flushParagraph();
      const items: string[] = [capitalizeFirstLetter(ordered[3].trim())];
      let j = i + 1;
      while (j < lines.length) {
        const nextOrdered = lines[j].match(ORDERED_LIST_MARKER);
        if (!nextOrdered) break;
        items.push(capitalizeFirstLetter(nextOrdered[3].trim()));
        j += 1;
      }
      blocks.push({ type: 'list', ordered: true, items });
      i = j - 1;
      continue;
    }

    const bullet = line.match(BULLET_LIST_MARKER);
    if (bullet) {
      hasListBlock = true;
      flushParagraph();
      const items: string[] = [capitalizeFirstLetter(bullet[1].trim())];
      let j = i + 1;
      while (j < lines.length) {
        const nextBullet = lines[j].match(BULLET_LIST_MARKER);
        if (!nextBullet) break;
        items.push(capitalizeFirstLetter(nextBullet[1].trim()));
        j += 1;
      }
      blocks.push({ type: 'list', ordered: false, items });
      i = j - 1;
      continue;
    }

    paragraphLines.push(line);
  }

  flushParagraph();
  if (hasListBlock && blocks.length > 0) return blocks;
  return parseInlineOrderedList(text);
}

function normalizeListLikeText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return parseListLikeRichTextBlocks(value) ?? value;
}

function normalizeHeadingSummaryArray(arr: unknown): void {
  if (!Array.isArray(arr)) return;
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const block = item as Record<string, unknown>;
    if ('summary' in block) {
      block.summary = normalizeListLikeText(block.summary);
    }
  }
}

/** Section-like shape with optional section_detail for summary extraction. */
type SectionLike = {
  type: string;
  section_heading?: string;
  section_detail?: { section_detail_summary?: string; summary_detail_bullets?: string[] };
};

/** Turn assessment/consensus sections (or a single section) into a short plain-text summary. Finds the section with the given type and combines section_detail_summary + bullets. */
export function narrativeToSummaryText(
  sections: SectionLike[] | undefined,
  sectionType: string = 'narrative',
  maxChars: number = 500
): string {
  if (!Array.isArray(sections) || sections.length === 0) return '';
  const section = sections.find((s) => s.type === sectionType);
  if (!section?.section_detail) return '';
  const detail = section.section_detail;
  const summary = typeof detail.section_detail_summary === 'string' ? detail.section_detail_summary.trim() : '';
  const bullets = Array.isArray(detail.summary_detail_bullets)
    ? detail.summary_detail_bullets.map((b) => (typeof b === 'string' ? b : String(b)).trim()).filter(Boolean)
    : [];
  const combined = [summary, ...bullets].filter(Boolean).join(' ');
  return combined.length > maxChars ? combined.substring(0, maxChars) : combined;
}

function normalizeSectionDetail(section: unknown): void {
  if (!section || typeof section !== 'object') return;
  const s = section as Record<string, unknown>;
  const detail = s.section_detail;
  if (detail != null && typeof detail === 'object' && !Array.isArray(detail)) {
    const d = detail as Record<string, unknown>;
    d.section_detail_summary = normalizeListLikeText(d.section_detail_summary);
    if (Array.isArray(d.summary_detail_bullets)) {
      d.summary_detail_bullets = d.summary_detail_bullets.map((b) =>
        typeof b === 'string' ? b : String(b)
      );
    }
  }
}

export function normalizeStructuredListFields(outputSchema: OutputSchemaName | undefined, data: unknown): unknown {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const out = data as Record<string, unknown>;

  if (outputSchema === 'assessment' || outputSchema === 'interview_assessment') {
    if (Array.isArray(out.sections)) {
      out.sections.forEach(normalizeSectionDetail);
    }
    return out;
  }

  if (outputSchema === 'consensus') {
    if (Array.isArray(out.sections)) {
      out.sections.forEach(normalizeSectionDetail);
    }
    if (out.reasoning != null && typeof out.reasoning === 'object' && !Array.isArray(out.reasoning))
      normalizeSectionDetail(out.reasoning);
    const cvs = out.cv_rewrite_strategy;
    if (cvs != null && typeof cvs === 'object' && !Array.isArray(cvs)) normalizeSectionDetail(cvs);
    if (out.director_signal_strength != null && typeof out.director_signal_strength === 'object')
      normalizeSectionDetail(out.director_signal_strength);
    if (Array.isArray(out.validated_strengths)) out.validated_strengths.forEach(normalizeSectionDetail);
    if (Array.isArray(out.validated_gaps)) out.validated_gaps.forEach(normalizeSectionDetail);
    if (Array.isArray(out.risk_flags)) out.risk_flags.forEach(normalizeSectionDetail);
    if (Array.isArray(out.rewrite_constraints)) out.rewrite_constraints.forEach(normalizeSectionDetail);
    if (out.partial_assessments != null && typeof out.partial_assessments === 'object')
      normalizeSectionDetail(out.partial_assessments);
    if (out.growth_potential != null && typeof out.growth_potential === 'object')
      normalizeSectionDetail(out.growth_potential);
    if (out.leadership_level != null && typeof out.leadership_level === 'object')
      normalizeSectionDetail(out.leadership_level);
    if (out.cultural_fit_level != null && typeof out.cultural_fit_level === 'object')
      normalizeSectionDetail(out.cultural_fit_level);
    if (out.team_integration_potential != null && typeof out.team_integration_potential === 'object')
      normalizeSectionDetail(out.team_integration_potential);
    return out;
  }

  if (outputSchema === 'cv_optimization') {
    normalizeHeadingSummaryArray(out.rationale);
    out.ats_optimization = normalizeListLikeText(out.ats_optimization);
    return out;
  }

  if (outputSchema === 'formatted_skills') {
    if (!Array.isArray(out.missing_skills)) out.missing_skills = [];
    if (out.skill_representation_mode !== 'keywords' && out.skill_representation_mode !== 'narrative') {
      out.skill_representation_mode = 'keywords';
    }
    if (out.skills_formatted != null && typeof out.skills_formatted === 'object' && !Array.isArray(out.skills_formatted)) {
      out.skills_formatted = normalizeSkillsFormattedRecord(out.skills_formatted as Record<string, unknown>);
    }
    if (Array.isArray(out.section_title_recommendations)) {
      out.section_title_recommendations = dedupeSectionTitleRecommendations(
        out.section_title_recommendations as SectionTitleRecommendationInput[]
      );
    }
    return out;
  }

  if (outputSchema === 'formatted_experience') {
    if (!Array.isArray(out.experience_formatted)) out.experience_formatted = [];
    const ef = out.experience_format_used;
    if (
      ef != null &&
      ef !== 'bullets' &&
      ef !== 'hybrid' &&
      ef !== 'narrative'
    ) {
      delete out.experience_format_used;
    }
    return out;
  }

  if (outputSchema === 'signal_normalized') {
    if (out.aggregated_signals != null && typeof out.aggregated_signals === 'object') {
      const agg = out.aggregated_signals as Record<string, unknown>;
      for (const key of SIGNAL_AGGREGATED_KEYS) {
        if (!Array.isArray(agg[key])) agg[key] = [];
      }
      // Backfill confidence_scores when empty: API cannot require record type, so model often omits it
      const conf = out.confidence_scores as Record<string, number> | undefined;
      const hasScores = conf && typeof conf === 'object' && Object.keys(conf).length > 0;
      if (!hasScores) {
        out.confidence_scores = {} as Record<string, number>;
        for (const key of SIGNAL_AGGREGATED_KEYS) {
          const arr = agg[key] as unknown[];
          (out.confidence_scores as Record<string, number>)[key] = Array.isArray(arr) && arr.length > 0 ? 70 : 0;
        }
      }
    }
    if (!Array.isArray(out.signal_gaps)) out.signal_gaps = [];
    return out;
  }

  if (outputSchema === 'recruiter_reality_validation') {
    if (!Array.isArray(out.inflation_flags)) out.inflation_flags = [];
    if (!Array.isArray(out.director_signal_gaps)) out.director_signal_gaps = [];
    if (!Array.isArray(out.weak_evidence_signals)) out.weak_evidence_signals = [];
    if (!Array.isArray(out.unsupported_scope_claims)) out.unsupported_scope_claims = [];
    if (!Array.isArray(out.rewrite_constraints)) out.rewrite_constraints = [];
    return out;
  }

  if (outputSchema === 'evidence_synthesiser') {
    if (!Array.isArray(out.scope_signals)) out.scope_signals = [];
    if (!Array.isArray(out.execution_signals)) out.execution_signals = [];
    if (!Array.isArray(out.leadership_signals)) out.leadership_signals = [];
    if (!Array.isArray(out.business_signals)) out.business_signals = [];
    if (!Array.isArray(out.risk_signals)) out.risk_signals = [];
    if (out.signal_confidence == null || typeof out.signal_confidence !== 'object') {
      out.signal_confidence = { scope: 0, execution: 0, leadership: 0, business: 0 };
    }
    if (typeof out.evidence_template_applied !== 'boolean') out.evidence_template_applied = false;
    if (!Array.isArray(out.signal_gaps_against_template)) out.signal_gaps_against_template = [];
    return out;
  }

  if (outputSchema === 'panel_weighting') {
    if (out.weighted_scores == null || typeof out.weighted_scores !== 'object') {
      out.weighted_scores = { technical: 0, leadership: 0, execution: 0, culture: 0 };
    }
    if (!Array.isArray(out.panel_risk_flags)) out.panel_risk_flags = [];
    return out;
  }

  if (outputSchema === 'calibrated_signals') {
    if (!Array.isArray(out.comparable_dimensions)) out.comparable_dimensions = [];
    const dims = out.comparable_dimensions as string[];
    // API cannot require record types, so model often returns empty calibrated_scores/calibrated_signals; backfill from comparable_dimensions
    const scores = out.calibrated_scores as Record<string, number> | undefined;
    const signals = out.calibrated_signals as Record<string, number | string[]> | undefined;
    const hasScores = scores && typeof scores === 'object' && Object.keys(scores).length > 0;
    const hasSignals = signals && typeof signals === 'object' && Object.keys(signals).length > 0;
    if (!hasScores && dims.length > 0) {
      out.calibrated_scores = {} as Record<string, number>;
      for (const d of dims) {
        if (typeof d === 'string') (out.calibrated_scores as Record<string, number>)[d] = 70;
      }
    }
    if (!hasSignals && dims.length > 0) {
      out.calibrated_signals = {} as Record<string, number>;
      for (const d of dims) {
        if (typeof d === 'string') (out.calibrated_signals as Record<string, number>)[d] = 70;
      }
    }
    return out;
  }

  if (outputSchema === 'anomaly_detection') {
    if (!Array.isArray(out.anomaly_type)) out.anomaly_type = [];
    if (!Array.isArray(out.affected_fields)) out.affected_fields = [];
    return out;
  }

  if (outputSchema === 'seniority_signal_enforcement') {
    if (!Array.isArray(out.missing_signals)) out.missing_signals = [];
    if (!Array.isArray(out.rewrite_constraints)) out.rewrite_constraints = [];
    const targetClass = out.target_seniority_class;
    if (
      targetClass !== 'entry' &&
      targetClass !== 'intermediate' &&
      targetClass !== 'senior' &&
      targetClass !== 'lead' &&
      targetClass !== 'manager' &&
      targetClass !== 'head' &&
      targetClass !== 'executive' &&
      targetClass !== 'unknown'
    ) {
      out.target_seniority_class = 'unknown';
    }
    const candidateClass = out.candidate_seniority_class;
    if (
      candidateClass !== 'entry' &&
      candidateClass !== 'intermediate' &&
      candidateClass !== 'senior' &&
      candidateClass !== 'lead' &&
      candidateClass !== 'manager' &&
      candidateClass !== 'head' &&
      candidateClass !== 'executive' &&
      candidateClass !== 'unknown'
    ) {
      out.candidate_seniority_class = 'unknown';
    }
    if (out.skill_representation_mode !== 'keywords' && out.skill_representation_mode !== 'narrative') out.skill_representation_mode = 'keywords';
    if (out.experience_format !== 'bullets' && out.experience_format !== 'hybrid' && out.experience_format !== 'narrative') out.experience_format = 'bullets';
    return out;
  }

  return out;
}

// Helpers for background normalizer (rich text content)
function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isRichTextBlock(value: unknown): value is RichTextBlock {
  if (!isJsonSchemaObject(value) || typeof value.type !== 'string') return false;
  if (value.type === 'paragraph') {
    return typeof value.text === 'string' && value.text.trim().length > 0;
  }
  if (value.type === 'list') {
    return (
      typeof value.ordered === 'boolean' &&
      Array.isArray(value.items) &&
      value.items.length > 0 &&
      value.items.every((item) => typeof item === 'string' && item.trim().length > 0)
    );
  }
  return false;
}

export function normalizeRichTextContentValue(value: unknown): RichTextContent | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    const blocks = value.filter(isRichTextBlock);
    return blocks.length > 0 ? blocks : undefined;
  }
  if (value == null) return undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      return serialized && serialized !== '{}' ? serialized : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
