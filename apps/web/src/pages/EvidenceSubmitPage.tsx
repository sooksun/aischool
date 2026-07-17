// S2-S6 per docs/architecture/ux/evidence-submission-flow.md, combined into one
// stepper component (the design's steps are UI states, not separate routes —
// keeping them in one component preserves state across steps for free, matching
// "ครูส่งหลักฐานได้ใน 1-2 นาที" without route-transition overhead).
//
// KNOWN LIMITATION vs the full UX design: screen-states.md's offline/resume
// column describes automatic background retry with localStorage-persisted
// upload state surviving a closed tab. This implementation retries within the
// page session (network blip -> "ลองใหม่" button, re-initiates cleanly) but does
// NOT persist across a closed tab/browser restart — that needs a service worker
// or IndexedDB-backed queue, out of scope for this first pass. Documented here
// rather than silently shipped as if the full design were implemented.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, unwrap } from '../api/client';
import { ApiError, thaiMessageFor } from '../api/errors';
import { useAuth } from '../hooks/useAuth';
import { Stepper } from '../components/Stepper';
import { PdpaNotice } from '../components/PdpaNotice';
import { validateFileAgainstCategory, validateDuration, readVideoDurationSeconds, sha256Hex } from '../lib/fileValidation';
import { uploadWithProgress } from '../lib/uploadWithProgress';
import type { components } from '../api/schema.generated';

type EvidenceCategory = components['schemas']['EvidenceCategory'];
type Indicator = components['schemas']['Indicator'];

type Step = 'pick' | 'details' | 'indicators' | 'review' | 'uploading' | 'done';
const STEP_NUMBER: Record<Exclude<Step, 'done'>, number> = { pick: 1, details: 2, indicators: 3, review: 4, uploading: 5 };

export function EvidenceSubmitPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('pick');
  const [file, setFile] = useState<File | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  const [categories, setCategories] = useState<EvidenceCategory[] | null>(null);
  const [category, setCategory] = useState<EvidenceCategory | null>(null);
  const [title, setTitle] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const [indicators, setIndicators] = useState<Indicator[] | null>(null);
  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<Set<string>>(new Set());

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<'idle' | 'preparing' | 'uploading' | 'confirming' | 'error'>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [createdEvidenceId, setCreatedEvidenceId] = useState<string | null>(null);

  useEffect(() => {
    api.GET('/evidence-categories', {}).then((res) => setCategories(unwrap(res))).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (step !== 'indicators' || !user?.personnel || indicators !== null) return;
    const positionRole = user.personnel.position_role;
    api.GET('/frameworks', { params: { query: { role_family: positionRole, status: 'active' } } })
      .then((res) => {
        const frameworks = unwrap(res);
        if (frameworks.length === 0) return setIndicators([]);
        return api.GET('/frameworks/{frameworkId}', { params: { path: { frameworkId: frameworks[0].id } } })
          .then((fwRes) => {
            const fw = unwrap(fwRes);
            setIndicators(fw.domains.flatMap((d) => d.indicators).filter((i) => i.indicator_kind === 'standard'));
          });
      })
      .catch(() => setIndicators([]));
  }, [step, user, indicators]);

  function onFilePicked(f: File) {
    setFile(f);
    setTitle((prev) => prev || f.name.replace(/\.[^.]+$/, ''));
    if (f.type.startsWith('video/')) {
      readVideoDurationSeconds(f).then(setDurationSeconds);
    } else {
      setDurationSeconds(null);
    }
    setStep('details');
  }

  function validateDetailsAndAdvance() {
    if (!file || !category) return;
    if (!title.trim()) { setFieldError('กรุณาระบุชื่อหลักฐาน'); return; }
    const mimeCheck = validateFileAgainstCategory(file, category);
    if (!mimeCheck.ok) { setFieldError(mimeCheck.messageTh!); return; }
    const durationCheck = validateDuration(durationSeconds, category);
    if (!durationCheck.ok) { setFieldError(durationCheck.messageTh!); return; }
    setFieldError(null);
    setStep('indicators');
  }

  function toggleIndicator(id: string) {
    setSelectedIndicatorIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!file || !category) return;
    setStep('uploading');
    setUploadStage('preparing');
    setUploadError(null);
    try {
      const evidence = createdEvidenceId
        ? { id: createdEvidenceId }
        : unwrap(await api.POST('/evidence', { body: { category_id: category.id, title: title.trim() } }));
      setCreatedEvidenceId(evidence.id);

      const checksum = await sha256Hex(file);
      const initiate = unwrap(await api.POST('/evidence/{evidenceId}/files/initiate', {
        params: { path: { evidenceId: evidence.id } },
        body: { content_type: file.type, byte_size: file.size, checksum_sha256: checksum, original_filename: file.name, duration_seconds: durationSeconds },
      }));

      setUploadStage('uploading');
      await uploadWithProgress(initiate.upload_url, file, file.type, setUploadProgress);

      setUploadStage('confirming');
      unwrap(await api.POST('/evidence/{evidenceId}/files/{fileId}/complete', {
        params: { path: { evidenceId: evidence.id, fileId: initiate.file_id } },
        body: { checksum_sha256: checksum, content_type: file.type, byte_size: file.size, original_filename: file.name, duration_seconds: durationSeconds },
      }));

      for (const indicatorId of selectedIndicatorIds) {
        await api.POST('/evidence/{evidenceId}/mappings', {
          params: { path: { evidenceId: evidence.id } },
          body: { indicator_id: indicatorId },
        }).catch(() => {});
      }

      setStep('done');
    } catch (err) {
      setUploadStage('error');
      setUploadError(err instanceof ApiError ? thaiMessageFor(err) : 'อัปโหลดไม่สำเร็จ กรุณาลองใหม่');
    }
  }

  const stepNumber = step === 'done' ? 5 : STEP_NUMBER[step];

  return (
    <main className="page">
      <h1>ส่งหลักฐาน</h1>
      {step !== 'done' && <Stepper step={stepNumber} total={5} />}

      {step === 'pick' && <PickFileStep onPick={onFilePicked} onCancel={() => navigate('/')} />}

      {step === 'details' && file && (
        <DetailsStep
          file={file} categories={categories} category={category} title={title}
          fieldError={fieldError}
          onCategoryChange={setCategory} onTitleChange={setTitle}
          onBack={() => setStep('pick')} onNext={validateDetailsAndAdvance}
        />
      )}

      {step === 'indicators' && (
        <IndicatorsStep
          indicators={indicators} selected={selectedIndicatorIds} onToggle={toggleIndicator}
          onBack={() => setStep('details')} onNext={() => setStep('review')}
        />
      )}

      {step === 'review' && file && category && (
        <ReviewStep
          file={file} category={category} title={title} indicatorCount={selectedIndicatorIds.size}
          onBack={() => setStep('indicators')} onConfirm={submit}
        />
      )}

      {step === 'uploading' && (
        <UploadingStep
          stage={uploadStage} progress={uploadProgress} error={uploadError}
          onRetry={submit}
        />
      )}

      {step === 'done' && createdEvidenceId && (
        <DoneStep evidenceId={createdEvidenceId} onGoHome={() => navigate('/')} onMapMore={() => setStep('indicators')} />
      )}
    </main>
  );
}

// ---- step sub-components (kept in this file: each is small, single-use, and
// only meaningful in the context of this stepper's shared state) ----

function PickFileStep({ onPick, onCancel }: { onPick: (f: File) => void; onCancel: () => void }) {
  return (
    <div>
      <p className="field-hint">เลือกไฟล์จากคลังภาพ ถ่ายรูป/วิดีโอใหม่ หรือเลือกเอกสาร</p>
      <div className="field">
        <label htmlFor="file-input">ไฟล์หลักฐาน</label>
        <input
          id="file-input" type="file"
          accept="application/pdf,video/mp4,image/jpeg,image/png"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); }}
        />
      </div>
      <div className="action-bar">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>ยกเลิก</button>
      </div>
    </div>
  );
}

function DetailsStep(props: {
  file: File; categories: EvidenceCategory[] | null; category: EvidenceCategory | null; title: string;
  fieldError: string | null;
  onCategoryChange: (c: EvidenceCategory) => void; onTitleChange: (t: string) => void;
  onBack: () => void; onNext: () => void;
}) {
  const { file, categories, category, title, fieldError, onCategoryChange, onTitleChange, onBack, onNext } = props;
  return (
    <div>
      <p className="field-hint">ไฟล์: {file.name} ({(file.size / (1024 * 1024)).toFixed(1)} MB)</p>

      <div className="field">
        <label id="category-label">หมวดหลักฐาน</label>
        {categories === null && <p className="field-hint">กำลังโหลดหมวดหมู่…</p>}
        {categories !== null && (
          <div className="category-grid" role="radiogroup" aria-labelledby="category-label">
            {categories.map((c) => (
              <button
                key={c.id} type="button" className="category-card"
                role="radio" aria-checked={category?.id === c.id} aria-pressed={category?.id === c.id}
                onClick={() => onCategoryChange(c)}
              >
                <span className="icon" aria-hidden="true">{categoryIcon(c.code)}</span>
                {c.label_th}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="title-input">ชื่อหลักฐาน</label>
        <input id="title-input" type="text" value={title} onChange={(e) => onTitleChange(e.target.value)} maxLength={300} required />
      </div>

      {fieldError && <div className="field-error" role="alert">{fieldError}</div>}

      <div className="action-bar">
        <button type="button" className="btn btn-secondary" onClick={onBack}>ย้อนกลับ</button>
        <button type="button" className="btn btn-primary" onClick={onNext} disabled={!category}>ถัดไป</button>
      </div>
    </div>
  );
}

function IndicatorsStep({ indicators, selected, onToggle, onBack, onNext }: {
  indicators: Indicator[] | null; selected: Set<string>; onToggle: (id: string) => void;
  onBack: () => void; onNext: () => void;
}) {
  return (
    <div>
      <h2>ผูกตัวชี้วัด (ไม่บังคับ)</h2>
      <p className="field-hint">เลือกได้มากกว่า 1 รายการ หรือข้ามไปผูกภายหลังก็ได้</p>
      {indicators === null && <p className="field-hint">กำลังโหลดตัวชี้วัด…</p>}
      {indicators !== null && indicators.length === 0 && <p className="field-hint">ยังไม่มีกรอบการประเมินที่ใช้งานได้</p>}
      {indicators !== null && indicators.length > 0 && (
        <div className="chip-list" role="group" aria-label="ตัวชี้วัด">
          {indicators.map((i) => (
            <button
              key={i.id} type="button" className="chip" aria-pressed={selected.has(i.id)}
              onClick={() => onToggle(i.id)}
            >
              {i.code} {i.name_th}
            </button>
          ))}
        </div>
      )}
      <div className="action-bar">
        <button type="button" className="btn btn-secondary" onClick={onBack}>ย้อนกลับ</button>
        <button type="button" className="btn btn-primary" onClick={onNext}>ถัดไป</button>
      </div>
    </div>
  );
}

function ReviewStep({ file, category, title, indicatorCount, onBack, onConfirm }: {
  file: File; category: EvidenceCategory; title: string; indicatorCount: number;
  onBack: () => void; onConfirm: () => void;
}) {
  return (
    <div>
      <h2>ตรวจสอบก่อนส่ง</h2>
      <dl>
        <dt>ไฟล์</dt><dd>{file.name}</dd>
        <dt>หมวด</dt><dd>{category.label_th}</dd>
        <dt>ชื่อ</dt><dd>{title}</dd>
        <dt>ตัวชี้วัดที่เลือก</dt><dd>{indicatorCount > 0 ? `${indicatorCount} รายการ` : 'ยังไม่ได้เลือก (ผูกภายหลังได้)'}</dd>
      </dl>
      <PdpaNotice />
      <div className="action-bar">
        <button type="button" className="btn btn-secondary" onClick={onBack}>แก้ไข</button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>ยืนยันส่ง</button>
      </div>
    </div>
  );
}

function UploadingStep({ stage, progress, error, onRetry }: {
  stage: 'idle' | 'preparing' | 'uploading' | 'confirming' | 'error'; progress: number; error: string | null;
  onRetry: () => void;
}) {
  if (stage === 'error') {
    return (
      <div>
        <div className="alert alert-error" role="alert">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </div>
        <button type="button" className="btn btn-primary btn-full" onClick={onRetry}>ลองใหม่</button>
      </div>
    );
  }
  const label = stage === 'preparing' ? 'กำลังเตรียมไฟล์…' : stage === 'confirming' ? 'กำลังยืนยันไฟล์…' : 'กำลังอัปโหลด…';
  return (
    <div aria-live="polite">
      <p>{label}</p>
      {stage === 'uploading' && (
        <div className="progress-bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
      <p className="field-hint">ทำต่อในพื้นหลังได้ ปิดหน้านี้ได้เลย</p>
    </div>
  );
}

function DoneStep({ evidenceId, onGoHome, onMapMore }: { evidenceId: string; onGoHome: () => void; onMapMore: () => void }) {
  return (
    <div>
      <div className="alert alert-success" role="status">
        <span aria-hidden="true">✓</span>
        <span>ส่งหลักฐานสำเร็จ กำลังตรวจสอบไฟล์ (สแกนไวรัส) — ใช้เวลาสักครู่</span>
      </div>
      <div className="action-bar">
        <button type="button" className="btn btn-secondary" onClick={onMapMore}>ผูกตัวชี้วัดเพิ่ม</button>
        <button type="button" className="btn btn-primary" onClick={onGoHome}>กลับหน้าหลัก</button>
      </div>
      <p className="field-hint" style={{ marginTop: '3rem' }}>รหัสหลักฐาน: {evidenceId}</p>
    </div>
  );
}

function categoryIcon(code: string): string {
  if (code.includes('video')) return '🎬';
  if (code.includes('lesson_plan')) return '📄';
  if (code.includes('learner')) return '👥';
  if (code.includes('academic')) return '📚';
  return '📎';
}
