// §9.1 — Pure wikitext/HTML stripping and crush-field normalization for Wavu notes.
import type { Move } from '../schemas';

/** Strips MediaWiki templates {{...}}, links [[...|text]] -> text, and HTML tags. Pure. */
export function stripWikitext(text: string): string {
  let out = text;
  // Templates, innermost first: {{name|...}} is dropped wholesale.
  while (/\{\{[^{}]*\}\}/.test(out)) {
    out = out.replace(/\{\{[^{}]*\}\}/g, '');
  }
  // Links: [[Target|label]] -> label, [[Target]] -> Target.
  out = out.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  out = out.replace(/\[\[([^\]]+)\]\]/g, '$1');
  // External links: [https://... label] -> label.
  out = out.replace(/\[[^\s\]]+\s+([^\]]+)\]/g, '$1');
  // Bold/italic markup.
  out = out.replace(/'''?/g, '');
  return stripHtml(out);
}

/** Decodes HTML entities (named, decimal &#NN; and hex &#xHH;) found in Cargo
 *  fields. Runs to a fixed point so double-encoded values such as
 *  `&amp;#58;` (a literal `&#58;`) decode fully to `:`. Pure. */
export function decodeEntities(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass += 1) {
    const decoded = out
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
    if (decoded === out) return out;
    out = decoded;
  }
  return out;
}

/** Strips HTML tags and decodes the common entities found in Cargo fields. Pure.
 *  Entities are decoded FIRST: Cargo fields arrive entity-escaped
 *  (`&lt;div ...&gt;`), and stripping tags before decoding would leave the
 *  decoded tag text in the output. */
export function stripHtml(text: string): string {
  return decodeEntities(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes the crush field, which sometimes holds an HTML list
 * (`<div class="plainlist">...`), to space-separated states such as
 * 'js28~49 fs50~52' (§9.1). Pure.
 */
export function normalizeCrush(crush: string): string {
  return stripHtml(crush).replace(/,\s*/g, ' ');
}

/** Cleans a Wavu notes field: wikitext stripped, whitespace collapsed. Pure. */
export function cleanNotes(notes: string): string {
  return stripWikitext(notes);
}

/** Applies note/crush cleaning to a move record, returning a new record. Pure. */
export function cleanMove(move: Move): Move {
  return {
    ...move,
    notes: move.notes === undefined ? undefined : cleanNotes(move.notes),
    crush: move.crush === undefined ? undefined : normalizeCrush(move.crush),
  };
}
