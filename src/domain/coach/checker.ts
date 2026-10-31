// Spec §8.6 — guardrails and answer checking for coach answers.

import { tokenize } from '../notation/tokenize';

const FRAME_PATTERN = /\bi\d+(?:~\d+)?\b|[-+−]\d+(?:~\s*[-+−]?\d+)?[a-zA-Z]?/g;

function isDatePart(text: string, index: number, length: number): boolean {
  // "2026-10-29": the "-10" and "-29" are date parts, not frame values.
  const before = text.slice(Math.max(0, index - 7), index);
  const after = text.slice(index + length, index + length + 3);
  if (/^\d{4}$/.test(text.slice(Math.max(0, index - 4), index)) && /^-\d{2}/.test(after)) return true;
  if (/^\d{4}-\d{2}$/.test(before) && !/^\d/.test(after)) return true;
  return false;
}

function normalise(value: string): string {
  return value.replace(/−/g, '-').replace(/\s+/g, '').toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Frame-like tokens: `i` + digits (with optional range) and signed numbers with an optional suffix letter. */
export function extractFrameTokens(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(FRAME_PATTERN)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (isDatePart(text, index, token.length)) continue;
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

/**
 * Move inputs: whitespace-separated words that tokenize as notation with no
 * unknown tokens and at least one direction or button token.
 */
export function extractMoveInputs(text: string): string[] {
  const found: string[] = [];
  for (const raw of text.split(/\s+/)) {
    const word = raw.replace(/^[([{<"']+/, '').replace(/[.,;:!?\]})>"']+$/, '');
    if (word === '') continue;
    const tokens = tokenize(word);
    if (tokens.length === 0) continue;
    if (tokens.some((token) => token.type === 'unknown')) continue;
    if (!tokens.some((token) => token.type === 'dir' || token.type === 'button')) continue;
    if (!found.includes(word)) found.push(word);
  }
  return found;
}

/** Strip raw HTML and scripts from Markdown; the remaining text stays Markdown. */
export function sanitizeMarkdown(text: string): string {
  let out = text;
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/<[^>]*>/g, '');
  out = out.replace(/javascript:/gi, '');
  out = out.replace(/vbscript:/gi, '');
  return out;
}

export interface CheckedAnswer {
  text: string;
  /** Frame-like values absent from the context, in order of appearance. */
  flagged: string[];
  moves: string[];
  hadNextAction: boolean;
}

/**
 * Post-check an AI answer: flag frame-like values absent from the context
 * with an inline 'check this number' badge, enforce exactly one
 * 'Next action:' line (appending the rules coach's fallback when missing),
 * and sanitize the Markdown.
 */
export function checkAnswer(
  answer: string,
  context: string,
  nextActionFallback: string,
): CheckedAnswer {
  const sanitized = sanitizeMarkdown(answer);
  const contextNorm = normalise(context);
  const flagged: string[] = [];
  for (const token of extractFrameTokens(sanitized)) {
    const tokenNorm = normalise(token);
    let present = contextNorm.includes(tokenNorm);
    if (!present && tokenNorm.includes('~')) {
      const endpoints = tokenNorm.split('~');
      present = endpoints.every((endpoint) => endpoint !== '' && contextNorm.includes(endpoint));
    }
    if (!present && !flagged.includes(token)) flagged.push(token);
  }

  let text = sanitized;
  for (const token of flagged) {
    const badge = `${token} (check this number)`;
    if (text.includes(badge)) continue;
    // Replace both the ASCII-minus and typographic-minus spellings.
    const pattern = new RegExp(escapeRegExp(token).replace(/^-/, '[-−]'), 'g');
    text = text.replace(pattern, badge);
  }

  const hadNextAction = /^Next action:/m.test(text);
  if (!hadNextAction) {
    const fallback = sanitizeMarkdown(nextActionFallback).replace(/\s+/g, ' ').trim();
    text = `${text.replace(/\s+$/, '')}\n\nNext action: ${fallback === '' ? "Review today's plan." : fallback}`;
  }
  return { text, flagged, moves: extractMoveInputs(sanitized), hadNextAction };
}
