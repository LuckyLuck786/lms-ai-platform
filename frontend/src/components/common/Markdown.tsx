import { Fragment, ReactNode } from 'react';

/**
 * Minimal markdown renderer for model-generated text (AI tutor replies,
 * summaries, flashcard rows).
 *
 * Deliberately tiny and dependency-free: it covers what our prompts actually
 * produce — headings, bullet/numbered lists, quotes, bold/italic and inline
 * code — and renders React nodes (never `dangerouslySetInnerHTML`), so model
 * output cannot inject markup.
 */

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  let match: RegExpExecArray | null;

  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${index}`;
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-900/10 px-1 py-0.5 font-mono text-[0.85em] dark:bg-white/10"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
    index += 1;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; lines: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] };

function toBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];

    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      const text = (bullet ?? numbered)![1];
      if (last && last.kind === kind) last.items.push(text);
      else blocks.push({ kind, items: [text] });
      continue;
    }
    if (!line.trim()) {
      continue;
    }
    if (heading) {
      blocks.push({ kind: 'h', lines: [heading[1]] });
      continue;
    }
    if (quote) {
      if (last && last.kind === 'quote') last.lines.push(quote[1]);
      else blocks.push({ kind: 'quote', lines: [quote[1]] });
      continue;
    }
    if (last && last.kind === 'p') last.lines.push(line);
    else blocks.push({ kind: 'p', lines: [line] });
  }
  return blocks;
}

export default function Markdown({ content, className = '' }: { content: string; className?: string }) {
  const blocks = toBlocks(content);
  return (
    <div className={`space-y-2 ${className}`}>
      {blocks.map((block, i) => {
        if (block.kind === 'ul' || block.kind === 'ol') {
          const List = block.kind === 'ul' ? 'ul' : 'ol';
          return (
            <List
              key={i}
              className={`ml-4 space-y-1 ${block.kind === 'ul' ? 'list-disc' : 'list-decimal'}`}
            >
              {block.items.map((item, j) => (
                <li key={j}>{inline(item, `${i}-${j}`)}</li>
              ))}
            </List>
          );
        }
        if (block.kind === 'h') {
          return (
            <p key={i} className="font-semibold">
              {inline(block.lines[0], String(i))}
            </p>
          );
        }
        if (block.kind === 'quote') {
          return (
            <blockquote
              key={i}
              className="border-l-2 border-slate-300 pl-3 italic text-slate-600 dark:border-slate-600 dark:text-slate-300"
            >
              {block.lines.map((line, j) => (
                <Fragment key={j}>{inline(line, `${i}-q${j}`)}</Fragment>
              ))}
            </blockquote>
          );
        }
        return (
          <p key={i}>
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && ' '}
                {inline(line, `${i}-p${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
