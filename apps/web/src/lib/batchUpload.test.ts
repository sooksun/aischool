import { describe, expect, test } from 'vitest';
import { newEntries, runBatch, type BatchEntry } from './batchUpload';

const file = (name: string, size = 3) => new File([new Uint8Array(size)], name, { lastModified: 1 });

describe('batch upload queue (FR-014)', () => {
  test('the same file dropped twice is listed once', () => {
    const a = file('a.pdf');
    const first = newEntries([a, file('b.pdf')]);
    expect(newEntries([a], first)).toEqual([]);
    expect(first).toHaveLength(2);
  });

  test('at most `concurrency` run at once, and one failure does not stop the rest', async () => {
    let running = 0;
    let peak = 0;
    const entries = newEntries([file('1'), file('2'), file('3'), file('4')]);
    const done = await runBatch(entries, async (e, update) => {
      running++;
      peak = Math.max(peak, running);
      update({ stage: 'uploading', progress: 0.5 });
      await new Promise((r) => setTimeout(r, 5));
      running--;
      if (e.file.name === '2') throw new Error('network error during upload');
    }, () => {}, 2);
    expect(peak).toBe(2);
    expect(done.map((e) => e.stage)).toEqual(['done', 'failed', 'done', 'done']);
    expect(done[1].error).toBe('network error during upload');
  });

  test('a retry runs only the failed ones, keeping what they already made', async () => {
    const entries: BatchEntry[] = newEntries([file('ok'), file('bad')]).map((e) =>
      e.file.name === 'ok' ? { ...e, stage: 'done', progress: 1 } : { ...e, stage: 'failed', evidenceId: 'ev-1', error: 'x' });
    const seen: string[] = [];
    const done = await runBatch(entries, async (e) => { seen.push(`${e.file.name}:${e.evidenceId}`); }, () => {});
    expect(seen).toEqual(['bad:ev-1']);
    expect(done.every((e) => e.stage === 'done')).toBe(true);
  });
});
