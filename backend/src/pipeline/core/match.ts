const matchCache = new Map<string, boolean>();

export function sequenceMatcherRatio(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a.length || !b.length) return 0.0;

  const matches = findMatchingBlocks(a, b);
  let totalMatched = 0;
  for (const [, , size] of matches) totalMatched += size;

  return (2.0 * totalMatched) / (a.length + b.length);
}

function findMatchingBlocks(a: string, b: string): [number, number, number][] {
  const b2j = new Map<string, number[]>();
  for (let i = 0; i < b.length; i++) {
    const ch = b[i];
    if (!b2j.has(ch)) b2j.set(ch, []);
    b2j.get(ch)!.push(i);
  }

  const blocks: [number, number, number][] = [];
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];

  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const match = findLongestMatch(a, b, alo, ahi, blo, bhi, b2j);

    if (match[2] > 0) {
      blocks.push(match);
      if (alo < match[0] && blo < match[1]) queue.push([alo, match[0], blo, match[1]]);
      if (match[0] + match[2] < ahi && match[1] + match[2] < bhi) {
        queue.push([match[0] + match[2], ahi, match[1] + match[2], bhi]);
      }
    }
  }

  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  const result: [number, number, number][] = [];
  let [i1, j1, k1] = [0, 0, 0];
  for (const [i2, j2, k2] of blocks) {
    if (i1 + k1 === i2 && j1 + k1 === j2) {
      k1 += k2;
    } else {
      if (k1) result.push([i1, j1, k1]);
      [i1, j1, k1] = [i2, j2, k2];
    }
  }
  if (k1) result.push([i1, j1, k1]);
  result.push([a.length, b.length, 0]);

  return result;
}

function findLongestMatch(
  a: string, b: string,
  alo: number, ahi: number, blo: number, bhi: number,
  b2j: Map<string, number[]>
): [number, number, number] {
  let bestI = alo, bestJ = blo, bestSize = 0;
  let j2len = new Map<number, number>();

  for (let i = alo; i < ahi; i++) {
    const newJ2len = new Map<number, number>();
    const indices = b2j.get(a[i]);
    if (indices) {
      for (const j of indices) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newJ2len.set(j, k);
        if (k > bestSize) { bestI = i - k + 1; bestJ = j - k + 1; bestSize = k; }
      }
    }
    j2len = newJ2len;
  }

  return [bestI, bestJ, bestSize];
}

export function checkMatch(t1: string, t2: string): boolean {
  if (t1 === t2) return true;
  if (!t1 || !t2 || t1[0] !== t2[0]) return false;
  if (t1 === 'WITH' || t1 === 'WITHOUT' || t2 === 'WITH' || t2 === 'WITHOUT') return false;

  const key = t1 < t2 ? `${t1}\0${t2}` : `${t2}\0${t1}`;
  if (matchCache.has(key)) return matchCache.get(key)!;

  const l1 = t1.length, l2 = t2.length;
  const minLen = Math.min(l1, l2), maxLen = Math.max(l1, l2);

  if (minLen >= 4 && (minLen / maxLen) >= 0.70) {
    if (t1.includes(t2) || t2.includes(t1)) { matchCache.set(key, true); return true; }
  }

  if (minLen >= 5) {
    const ratio = sequenceMatcherRatio(t1, t2);
    const threshold = minLen <= 6 ? 0.85 : 0.80;
    if (ratio >= threshold) { matchCache.set(key, true); return true; }
  }

  matchCache.set(key, false);
  return false;
}

export function clearMatchCache(): void {
  matchCache.clear();
}
