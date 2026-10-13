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

const run = (bin: string, args: string[], timeoutMs: number) => new Promise<string>((resolve, reject) => {
  execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, out) => (err ? reject(err) : resolve(out)));
});

/** A private temp copy of a stored object, removed by `cleanup`. */
export async function localCopy(body: Readable): Promise<{ path: string; dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'seip-media-'));
  const path = join(dir, 'media');
  await pipeline(body, createWriteStream(path));
  return { path, dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Null when the probe could not run (no ffprobe) or could not read the file. */
export async function probeFile(ffprobePath: string, path: string, timeoutMs = 60_000): Promise<MediaProbe | null> {
  try {
    return parseFfprobe(await run(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], timeoutMs));
  } catch (e) {
    console.warn(`[media-probe] not measured: ${(e as Error).message}`);
    return null;
  }
}

export async function probeMedia(ffprobePath: string, body: Readable, timeoutMs = 60_000): Promise<MediaProbe | null> {
  const copy = await localCopy(body);
  try {
    return await probeFile(ffprobePath, copy.path, timeoutMs);
  } finally {
    await copy.cleanup();
  }
}

/**
 * FR-021: the copy a browser plays — H.264/AAC MP4, at most 720 lines, moov
 * atom first so playback starts before the download ends. `-map_metadata -1`
 * drops container metadata, GPS location included; the original keeps
 * everything and is stored apart. False when ffmpeg is missing or fails.
 */
export async function transcodeReview720p(ffmpegPath: string, inPath: string, outPath: string, timeoutMs = 15 * 60_000): Promise<boolean> {
  try {
    await run(ffmpegPath, [
      '-v', 'error', '-y', '-i', inPath,
      '-vf', "scale=-2:'min(720,ih)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-map_metadata', '-1', outPath,
    ], timeoutMs);
    return true;
  } catch (e) {
    console.warn(`[media-probe] no 720p rendition: ${(e as Error).message}`);
    return false;
  }
}
