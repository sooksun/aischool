// fetch() has no upload-progress event — XHR is the only browser API that does,
// which is why this is hand-rolled instead of going through the fetch-based api
// client (these PUTs go straight to storage, not through apps/api anyway).
import { api, unwrap } from '../api/client';
import type { components } from '../api/schema.generated';

type UploadSession = components['schemas']['UploadSession'];
type PresignedRequest = components['schemas']['PresignedRequest'];

export function putWithProgress(
  request: Pick<PresignedRequest, 'url' | 'headers'>,
  body: Blob,
  onProgress: (loadedBytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', request.url);
    for (const [k, v] of Object.entries(request.headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.send(body);
  });
}

async function sha256Base64(blob: Blob): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  let s = '';
  for (const b of hash) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Moves the bytes of an open upload session (CCR-017): one presigned PUT for
 * single_put, otherwise the missing S3 multipart parts — each part signed with its
 * own SHA-256 so the store refuses a corrupted part. Parts the server already has
 * (`parts_received`) are skipped, so calling this again after a failure resumes.
 * `onProgress` receives the fraction of the whole file.
 */
export async function sendUploadBytes(
  session: UploadSession,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  if (session.protocol === 'single_put') {
    if (!session.single_put) throw new Error('single_put session without a presigned request');
    await putWithProgress(session.single_put, file, (loaded) => onProgress(loaded / file.size));
    return;
  }

  const received = new Set(session.parts_received);
  let done = session.parts_received.reduce((sum, n) => sum + partBlob(file, session.part_size, n).size, 0);
  for (let n = 1; n <= session.part_count; n++) {
    if (received.has(n)) continue;
    const part = partBlob(file, session.part_size, n);
    const checksum = await sha256Base64(part);
    const { parts } = unwrap(await api.POST('/uploads/{uploadId}/part-urls', {
      params: { path: { uploadId: session.id } },
      body: { part_numbers: [n], checksums_sha256: [checksum] },
    }));
    const base = done;
    await putWithProgress(parts[0].request, part, (loaded) => onProgress((base + loaded) / file.size));
    done += part.size;
    onProgress(done / file.size);
  }
}

function partBlob(file: File, partSize: number, partNumber: number): Blob {
  const start = (partNumber - 1) * partSize;
  return file.slice(start, Math.min(start + partSize, file.size));
}
