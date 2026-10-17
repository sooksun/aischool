// FR-014: several files at once, each becoming its own evidence item, with
// progress per file. The queue is pure (an injected `upload` does the work), so
// its rules — at most `concurrency` at a time, one failure never stops the
// rest, a retry resumes the same item — are unit-tested without a network.

export type BatchStage = 'waiting' | 'hashing' | 'uploading' | 'confirming' | 'done' | 'failed';

export interface BatchEntry {
  key: string;
  file: File;
  stage: BatchStage;
  /** 0..1 of this file's bytes. */
  progress: number;
  error: string | null;
  evidenceId: string | null;
  /** Items in my portfolio that already hold these bytes (CCR-026). */
  duplicateOf: { evidenceId: string; title: string }[];
}

export type Uploader = (
  entry: BatchEntry,
  update: (patch: Partial<BatchEntry>) => void,
) => Promise<void>;

export function newEntries(files: readonly File[], existing: readonly BatchEntry[] = []): BatchEntry[] {
  const seen = new Set(existing.map((e) => e.key));
  const out: BatchEntry[] = [];
  for (const file of files) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) continue; // the same file dropped twice
    seen.add(key);
    out.push({ key, file, stage: 'waiting', progress: 0, error: null, evidenceId: null, duplicateOf: [] });
  }
  return out;
}

/**
 * Runs `upload` over every entry still waiting or failed, `concurrency` at a
 * time. `onChange` gets each new snapshot. Resolves when all have settled.
 */
export async function runBatch(
  entries: BatchEntry[],
  upload: Uploader,
  onChange: (entries: BatchEntry[]) => void,
  concurrency = 2,
): Promise<BatchEntry[]> {
  let current = entries.map((e) => (e.stage === 'failed' ? { ...e, stage: 'waiting' as const, error: null } : e));
  const patch = (key: string, p: Partial<BatchEntry>) => {
    current = current.map((e) => (e.key === key ? { ...e, ...p } : e));
    onChange(current);
  };
  onChange(current);
  const todo = current.filter((e) => e.stage === 'waiting').map((e) => e.key);
  const worker = async () => {
    for (let key = todo.shift(); key !== undefined; key = todo.shift()) {
      const entry = current.find((e) => e.key === key)!;
      try {
        await upload(entry, (p) => patch(key, p));
        patch(key, { stage: 'done', progress: 1 });
      } catch (err) {
        patch(key, { stage: 'failed', error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return current;
}
