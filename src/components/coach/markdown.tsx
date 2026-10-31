/* Safe Markdown renderer — spec §8.6: no raw HTML, no scripts, no
 * dangerouslySetInnerHTML. Supports paragraphs, **bold**, *italic*, `code`,
 * -/* bullet lists, ## headings, and links (internal app routes and the two
 * trusted data sources only; anything else renders as plain text). */
import type { ReactNode } from 'react';

const ALLOWED_LINK = /^(https:\/\/(wavu\.wiki|tekkendocs\.com)\/\S*|\/(codex|lab|today|path|punish|cards|matchups|playbook|log|coach|settings)(\/\S*)?)$/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on links first, then inline code, bold, italic within each part.
  const linkRe = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let key = 0;
  const pushFormatted = (part: string) => {
    const codeRe = /`([^`]+)`/g;
    let cLast = 0;
    let match: RegExpExecArray | null;
    const segments: ReactNode[] = [];
    const pushRich = (rich: string) => {
      const boldRe = /\*\*([^*]+)\*\*/g;
      let bLast = 0;
      let bMatch: RegExpExecArray | null;
      const boldParts: ReactNode[] = [];
      while ((bMatch = boldRe.exec(rich)) !== null) {
        if (bMatch.index > bLast) boldParts.push(rich.slice(bLast, bMatch.index));
        boldParts.push(<strong key={`${keyPrefix}-b${key}`}>{bMatch[1]}</strong>);
        key += 1;
        bLast = bMatch.index + bMatch[0].length;
      }
      if (bLast < rich.length) {
        const tail = rich.slice(bLast);
        // Single-asterisk italics, only when the asterisks pair up.
        const italRe = /\*([^*]+)\*/g;
        let iLast = 0;
        let iMatch: RegExpExecArray | null;
        const italParts: ReactNode[] = [];
        while ((iMatch = italRe.exec(tail)) !== null) {
          if (iMatch.index > iLast) italParts.push(tail.slice(iLast, iMatch.index));
          italParts.push(<em key={`${keyPrefix}-i${key}`}>{iMatch[1]}</em>);
          key += 1;
          iLast = iMatch.index + iMatch[0].length;
        }
        if (iLast < tail.length) italParts.push(tail.slice(iLast));
        boldParts.push(...italParts);
      }
      segments.push(...boldParts);
    };
    while ((match = codeRe.exec(part)) !== null) {
      if (match.index > cLast) pushRich(part.slice(cLast, match.index));
      segments.push(<code key={`${keyPrefix}-c${key}`}>{match[1]}</code>);
      key += 1;
      cLast = match.index + match[0].length;
    }
    if (cLast < part.length) pushRich(part.slice(cLast));
    return segments;
  };
  let linkMatch: RegExpExecArray | null;
  while ((linkMatch = linkRe.exec(text)) !== null) {
    if (linkMatch.index > last) nodes.push(...pushFormatted(text.slice(last, linkMatch.index)));
    const label = linkMatch[1] as string;
    const href = linkMatch[2] as string;
    if (ALLOWED_LINK.test(href)) {
      nodes.push(
        <a key={`${keyPrefix}-a${key}`} href={href} {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}>
          {label}
        </a>,
      );
    } else {
      nodes.push(label);
    }
    key += 1;
    last = linkMatch.index + linkMatch[0].length;
  }
  if (last < text.length) nodes.push(...pushFormatted(text.slice(last)));
  return nodes;
}

export function renderSafeMarkdown(text: string): ReactNode {
  const lines = text.replace(/<[^>]*>/g, '').split('\n');
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let key = 0;
  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={`ul-${key}`}>
        {items.map((item, i) => (
          <li key={`li-${key}-${i}`}>{renderInline(item, `li-${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    key += 1;
  };
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^##\s+/.test(line)) {
      flushList();
      blocks.push(<h2 key={`h-${key}`}>{renderInline(line.replace(/^##\s+/, ''), `h-${key}`)}</h2>);
      key += 1;
    } else if (/^[-*]\s+/.test(line)) {
      list.push(line.replace(/^[-*]\s+/, ''));
    } else if (line.trim() === '') {
      flushList();
    } else {
      flushList();
      blocks.push(<p key={`p-${key}`}>{renderInline(line, `p-${key}`)}</p>);
      key += 1;
    }
  }
  flushList();
  return <>{blocks}</>;
}
