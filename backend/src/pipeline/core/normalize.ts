import { cleanText } from './utils';
import { getNormLexicon } from './lexicon-loader';
import type { NormLexicon } from './types';

export function replaceTokens(tokens: string[], src: string[], dst: string[]): string[] {
  if (!src.length) return tokens;
  const out: string[] = [];
  let i = 0;
  const n = tokens.length, m = src.length;

  while (i <= n - m) {
    let match = true;
    for (let j = 0; j < m; j++) {
      if (tokens[i + j] !== src[j]) { match = false; break; }
    }
    if (match) { out.push(...dst); i += m; }
    else { out.push(tokens[i]); i += 1; }
  }

  while (i < n) { out.push(tokens[i]); i++; }
  return out;
}

export function replaceTokensAtEnd(tokens: string[], src: string[], dst: string[]): string[] {
  if (!src.length) return tokens;
  const m = src.length;
  if (tokens.length < m) return tokens;

  const startIdx = tokens.length - m;
  let match = true;
  for (let j = 0; j < m; j++) {
    if (tokens[startIdx + j] !== src[j]) { match = false; break; }
  }

  return match ? [...tokens.slice(0, startIdx), ...dst] : tokens;
}

export function replaceTokensAtStart(tokens: string[], src: string[], dst: string[]): string[] {
  if (!src.length) return tokens;
  const m = src.length;
  if (tokens.length < m) return tokens;

  let match = true;
  for (let j = 0; j < m; j++) {
    if (tokens[j] !== src[j]) { match = false; break; }
  }

  return match ? [...dst, ...tokens.slice(m)] : tokens;
}

export function deleteTokens(tokens: string[], src: string[]): string[] {
  if (!src.length) return tokens;
  const out: string[] = [];
  let i = 0;
  const n = tokens.length, m = src.length;

  while (i <= n - m) {
    let match = true;
    for (let j = 0; j < m; j++) {
      if (tokens[i + j] !== src[j]) { match = false; break; }
    }
    if (match) { i += m; }
    else { out.push(tokens[i]); i += 1; }
  }

  while (i < n) { out.push(tokens[i]); i++; }
  return out;
}

export function normalizeName(rawName: string, lexicon?: NormLexicon): string {
  const lex = lexicon || getNormLexicon();
  const base = cleanText(rawName);
  let tokens = base.split(/\s+/).filter(t => t !== '');

  for (const entry of lex.phase1) {
    if (!tokens.length) break;
    tokens = replaceTokens(tokens, entry.rawTokens, entry.normalizedTokens);
  }

  for (const entry of lex.phase2) {
    if (!tokens.length) break;
    if (entry.operation === 'end') tokens = replaceTokensAtEnd(tokens, entry.rawTokens, entry.normalizedTokens);
    else if (entry.operation === 'start') tokens = replaceTokensAtStart(tokens, entry.rawTokens, entry.normalizedTokens);
    else if (entry.operation === 'delete') tokens = deleteTokens(tokens, entry.rawTokens);
  }

  for (const entry of lex.phase2) {
    if (!tokens.length) break;
    if (entry.operation === 'replace') tokens = replaceTokens(tokens, entry.rawTokens, entry.normalizedTokens);
  }

  return tokens.join(' ');
}
