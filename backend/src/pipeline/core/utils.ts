export const FILLER_WORDS = new Set(['THE', 'OF', 'IN']);
export const SITE_STRINGS_TO_REMOVE = ['UNCHCSRAD'];

const SEPARATOR_CHARS = new Set(['/', ',', '&']);
const SPACE_REPLACE_CHARS = new Set(['½', 'Ï', 'Â']);
const PRESERVED_SYMBOLS = new Set(['+', '-', '<', '>']);

export function cleanText(s: string): string {
  if (s == null || s === '') return '';
  if (typeof s !== 'string') s = String(s);

  s = s.toUpperCase();

  for (const siteStr of SITE_STRINGS_TO_REMOVE) {
    s = s.split(siteStr).join('');
  }

  const cleanedChars: string[] = [];
  for (const ch of s) {
    if (SPACE_REPLACE_CHARS.has(ch)) { cleanedChars.push(' '); continue; }
    if (isAlphanumeric(ch) || ch === ' ') { cleanedChars.push(ch); continue; }
    if (PRESERVED_SYMBOLS.has(ch)) { cleanedChars.push(ch); continue; }
    if (SEPARATOR_CHARS.has(ch)) { cleanedChars.push(' '); continue; }
  }

  let cleaned = cleanedChars.join('');
  cleaned = cleaned.split('-').join('- ');

  const tokens = cleaned.split(/\s+/).filter(t => t !== '' && !FILLER_WORDS.has(t));
  return tokens.join(' ');
}

export function cleanTextForLexicon(s: string): string {
  return cleanText(s);
}

function isAlphanumeric(ch: string): boolean {
  if (ch.length !== 1) return false;
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return true;
  if (code >= 65 && code <= 90) return true;
  if (code >= 97 && code <= 122) return true;
  if (code > 127) return /[\p{L}\p{N}]/u.test(ch);
  return false;
}
