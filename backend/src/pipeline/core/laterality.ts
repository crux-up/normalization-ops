import type { LateralityState } from './types';

const SPECIFIC_LATERALITIES = new Set(['LEFT', 'RIGHT', 'BILATERAL']);

export function getLateralityState(lateralityValues: string[]): LateralityState {
  if (!lateralityValues || !Array.isArray(lateralityValues)) {
    return { hasLaterality: false, specific: null };
  }

  let hasLaterality = false;
  let specific: string | null = null;

  for (const val of lateralityValues) {
    const v = (val || '').trim().toUpperCase();
    if (!v) continue;
    hasLaterality = true;
    if (SPECIFIC_LATERALITIES.has(v)) { specific = v; break; }
  }

  return { hasLaterality, specific };
}

export function areLateralitiesCompatible(custSpecific: string | null, nvSpecific: string | null): boolean {
  if (custSpecific !== null && nvSpecific !== null) return custSpecific === nvSpecific;
  if (custSpecific !== null || nvSpecific !== null) return false;
  return true;
}
