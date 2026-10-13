// FR-021: measure a video or audio file on the server instead of trusting the
// length the client declared. ffprobe reads the container header from a temp
// copy of the stored object; nothing is decoded. When ffprobe is not installed
// (MEDIA_PROBE=none, or the binary is missing) the result is null — an
// honest "not measured", never an estimate.
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface MediaProbe {
  durationMs: number | null;
  width: number | null;
  height: number | null;
}

export function isProbeable(contentType: string): boolean {
  return contentType.startsWith('video/') || contentType.startsWith('audio/');
}

/** Parses `ffprobe -print_format json -show_format -show_streams`. */
export function parseFfprobe(json: string): MediaProbe {
  const out = JSON.parse(json) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[];
  };
  const video = out.streams?.find((s) => s.codec_type === 'video');
  const seconds = Number(out.format?.duration ?? video?.duration ?? NaN);
  return {
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    width: video?.width ?? null,
    height: video?.height ?? null,
  };
}

/** Null when the probe could not run (no ffprobe) or could not read the file. */
export async function probeMedia(ffprobePath: string, body: Readable, timeoutMs = 60_000): Promise<MediaProbe | null> {
  const dir = await mkdtemp(join(tmpdir(), 'seip-probe-'));
  const path = join(dir, 'media');
  try {
    await pipeline(body, createWriteStream(path));
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
        { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
        (err, out) => (err ? reject(err) : resolve(out)));
    });
    return parseFfprobe(stdout);
  } catch (e) {
    console.warn(`[media-probe] not measured: ${(e as Error).message}`);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
