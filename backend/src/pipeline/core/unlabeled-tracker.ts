import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', '..', '..', 'data');
const DEFAULT_FILE_NAME = 'unlabeled-tokens.json';

interface TrackerEntry {
  unlabeledTerm: string;
  rawStudyName: string;
  normalizedStudyName: string;
  firstSeenDate: string;
}

export class UnlabeledTracker {
  private dataDir: string;
  private fileName: string;
  private filePath: string;
  private _knownTerms: Set<string>;
  private _entries: TrackerEntry[];
  private _loaded: boolean;
  private _dirty: boolean;

  constructor(options: { dataDir?: string; fileName?: string } = {}) {
    this.dataDir = options.dataDir || DEFAULT_DATA_DIR;
    this.fileName = options.fileName || DEFAULT_FILE_NAME;
    this.filePath = path.join(this.dataDir, this.fileName);
    this._knownTerms = new Set();
    this._entries = [];
    this._loaded = false;
    this._dirty = false;
  }

  load(): void {
    if (this._loaded) return;

    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this._entries = data.entries || [];
        for (const entry of this._entries) {
          this._knownTerms.add(entry.unlabeledTerm);
        }
      }
    } catch (err: any) {
      console.warn(`Warning: Could not load unlabeled tokens from ${this.filePath}: ${err.message}`);
      this._entries = [];
      this._knownTerms.clear();
    }

    this._loaded = true;
  }

  track(options: { rawStudyName: string; normalizedStudyName: string; unlabeledTokens: string[] }): string[] {
    if (!this._loaded) this.load();

    const newTerms: string[] = [];

    for (const term of options.unlabeledTokens) {
      const termUpper = term.toUpperCase().trim();
      if (!termUpper) continue;
      if (this._knownTerms.has(termUpper)) continue;

      this._knownTerms.add(termUpper);
      const entry: TrackerEntry = {
        unlabeledTerm: termUpper,
        rawStudyName: options.rawStudyName || '',
        normalizedStudyName: options.normalizedStudyName || '',
        firstSeenDate: new Date().toISOString().split('T')[0],
      };
      this._entries.push(entry);
      newTerms.push(termUpper);
      this._dirty = true;
    }

    return newTerms;
  }

  save(): void {
    if (!this._dirty) return;

    const data = {
      version: '1.0',
      description: 'Running log of unlabeled tokens encountered during study name normalization.',
      lastUpdated: new Date().toISOString().split('T')[0],
      totalEntries: this._entries.length,
      entries: this._entries,
    };

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    this._dirty = false;
  }

  get size(): number {
    if (!this._loaded) this.load();
    return this._knownTerms.size;
  }

  has(term: string): boolean {
    if (!this._loaded) this.load();
    return this._knownTerms.has(term.toUpperCase().trim());
  }

  getEntries(): TrackerEntry[] {
    if (!this._loaded) this.load();
    return [...this._entries];
  }
}

let _defaultTracker: UnlabeledTracker | null = null;

export function getTracker(options: { dataDir?: string } = {}): UnlabeledTracker {
  if (!_defaultTracker) _defaultTracker = new UnlabeledTracker(options);
  return _defaultTracker;
}
