// P3 v0 analysis (ADR-0010; plan §3). Until the in-country GPU tier exists this
// runs the local_heuristic floor end to end and finishes `degraded`: extract
// (PDF text layer → page_block segments) → map (word overlap against the
// owner's framework) → validate (every quote verbatim in its segment) → store.
// Nothing leaves this process; evidence text is never logged.
import type { S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  getAnalysisInput, setAnalysisStage, completeAnalysis, failAnalysis, suggestFromSegments,
  HEURISTIC_MODEL_LABEL, HEURISTIC_PROMPT_VERSION, type NewSegment, type NewSuggestion,
} from '@seip/database';
import { getObjectStream } from '../s3.js';
import { pdfPageTexts } from '../pdf-text.js';
import type { Env } from '../env.js';

export interface EvidenceAnalyzePayload {
  analysis_id: string;
  evidence_id: string;
}

const PDF_MAX_BYTES = 64 * 1024 * 1024;

async function readAll(body: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(c as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

export async function processEvidenceAnalyze(env: Env, s3: S3Client, payload: EvidenceAnalyzePayload): Promise<void> {
  const input = await getAnalysisInput(payload.evidence_id);
  if (!input) {
    await failAnalysis(payload.analysis_id, 'RES-001');
    return;
  }
  const { evidence, framework } = input;

  await setAnalysisStage(payload.analysis_id, 'extracting', 'text_layer');
  const segments: NewSegment[] = [];
  for (const file of evidence.files) {
    if (file.contentType !== 'application/pdf' || Number(file.byteSize) > PDF_MAX_BYTES) continue;
    try {
      const bytes = await readAll((await getObjectStream(s3, env.S3_BUCKET, file.storageUri)) as Readable);
      for (const p of await pdfPageTexts(bytes)) {
        if (!p.text) continue;
        segments.push({ evidenceFileId: file.id, kind: 'page_block', ordinal: segments.length, page: p.page, text: p.text });
      }
    } catch (e) {
      // An unreadable PDF is not a failed analysis: the item still has its title.
      console.warn(`[evidence.analyze] no text from file ${file.id}: ${(e as Error).name}`);
    }
  }

  await setAnalysisStage(payload.analysis_id, 'mapping', HEURISTIC_PROMPT_VERSION);
  const contextText = [evidence.title, evidence.description, evidence.noteText].filter(Boolean).join('\n');
  const found = framework
    ? suggestFromSegments({
      contextText,
      segments: segments.map((s) => ({ id: String(s.ordinal), page: s.page, text: s.text })),
      indicators: framework.indicators,
    })
    : [];
  const suggestions: NewSuggestion[] = found.map((f) => ({
    indicatorId: f.indicatorId,
    band: f.band,
    rationaleTh: f.rationaleTh,
    locators: f.locators.map(({ segment_id, ...l }) => ({ ...l, segment_ordinal: Number(segment_id) })),
  }));

  await setAnalysisStage(payload.analysis_id, 'validating', 'quote_check');
  const inputSha256 = createHash('sha256')
    .update(contextText).update('\0')
    .update(evidence.files.map((f) => f.checksumSha256).sort().join(','))
    .digest('hex');
  await completeAnalysis({
    analysisId: payload.analysis_id, evidenceId: evidence.id, frameworkVersionId: framework?.id ?? null,
    // The heuristic floor: ADR-0010 tier unavailable, so degraded + provisional.
    status: 'degraded', provisional: true, modelLabel: HEURISTIC_MODEL_LABEL, promptVersion: HEURISTIC_PROMPT_VERSION,
    inputSha256, segments, suggestions,
  });
}
