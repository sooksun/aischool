// ข้อตกลงในการพัฒนางาน (แบบ PA1) — CCR-015 / SEIP-BLOCK-002.
//
// The evaluatee writes this themselves. Two things depend on it existing:
// scoring is unreachable without it (no agreement -> no workload declaration ->
// SCORE-004), and its ประเด็นท้าทาย is what indicators C.1/C.2.1/C.2.2 rate —
// 40 of the 100 points. Before this page, the committee scored that 40% having
// never seen the text.
//
// Submitting freezes the content on purpose: an evaluatee must not be able to
// rewrite the targets they are about to be scored against.
import { useEffect, useState } from 'react';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import { useAuth } from '../../hooks/useAuth';
import type { components } from '../../api/schema.generated';

type AgreementDetail = components['schemas']['AgreementDetail'];
type Cycle = components['schemas']['Cycle'];

const STATUS_LABEL: Record<string, string> = {
  draft: 'ร่าง — แก้ไขได้',
  submitted: 'ส่งแล้ว — รอผู้อำนวยการเห็นชอบ',
  acknowledged: 'ผู้อำนวยการเห็นชอบแล้ว',
};

export function AgreementPage() {
  const { user } = useAuth();
  const [agreements, setAgreements] = useState<AgreementDetail[] | null>(null);
  const [cycles, setCycles] = useState<Cycle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function reload() {
    setAgreements(null);
    setLoadError(null);
    api
      .GET('/agreements', { params: { query: {} } })
      .then((res) => {
        const list = unwrap(res);
        // The list endpoint returns Agreement (no challenge); fetch each detail so
        // the page can show what was actually written without a second click.
        return Promise.all(
          list.map((a) => api.GET('/agreements/{agreementId}', { params: { path: { agreementId: a.id } } })),
        );
      })
      .then((details) => setAgreements(details.map((d) => unwrap(d))))
      .catch((e) => setLoadError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดข้อตกลงไม่สำเร็จ'));
  }

  useEffect(reload, []);

  useEffect(() => {
    api
      .GET('/cycles', { params: { query: {} } })
      .then((res) => setCycles(unwrap(res)))
      .catch(() => setCycles([]));
  }, []);

  // Cycles that do not already have an agreement — one per (cycle, personnel) is
  // a contract rule (AGR-001), so offering a taken cycle would only produce a 409.
  const availableCycles = (cycles ?? []).filter(
    (c) => !(agreements ?? []).some((a) => a.cycle_id === c.id),
  );

  if (!user?.personnel) {
    return (
      <main className="page">
        <h1>ข้อตกลงในการพัฒนางาน</h1>
        <div className="alert alert-info" role="note">
          <span>
            บัญชีนี้ไม่มีข้อมูลบุคลากรในโรงเรียน จึงไม่ต้องจัดทำข้อตกลง (เช่น กรรมการประเมินจากภายนอก)
          </span>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>ข้อตกลงในการพัฒนางาน (PA1)</h1>
      <p className="field-hint">
        ระบุประเด็นท้าทาย วิธีดำเนินการ และผลลัพธ์ที่คาดหวัง — ส่วนนี้คิดเป็น 40 คะแนนจาก 100
        และเป็นข้อความที่คณะกรรมการใช้พิจารณาให้คะแนน
      </p>

      {loadError && (
        <div className="alert alert-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="btn btn-secondary" onClick={reload}>ลองใหม่</button>
        </div>
      )}

      {agreements === null && !loadError && <p className="field-hint">กำลังโหลด…</p>}

      {agreements?.length === 0 && !creating && (
        <div className="empty-state">
          <p>ยังไม่มีข้อตกลง</p>
          <p className="field-hint">จัดทำข้อตกลงสำหรับรอบการประเมินปีนี้เพื่อให้คณะกรรมการประเมินได้</p>
        </div>
      )}

      {availableCycles.length > 0 && !creating && (
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          + จัดทำข้อตกลงใหม่
        </button>
      )}

      {creating && (
        <AgreementForm
          cycles={availableCycles}
          personnelId={user.personnel.id}
          onDone={() => { setCreating(false); reload(); }}
          onCancel={() => setCreating(false)}
        />
      )}

      {agreements?.map((a) => (
        <AgreementCard
          key={a.id}
          agreement={a}
          cycleTitle={(cycles ?? []).find((c) => c.id === a.cycle_id)?.title}
          editing={editingId === a.id}
          onEdit={() => setEditingId(a.id)}
          onDoneEditing={() => { setEditingId(null); reload(); }}
          onChanged={reload}
        />
      ))}
    </main>
  );
}

function AgreementCard({ agreement, cycleTitle, editing, onEdit, onDoneEditing, onChanged }: {
  agreement: AgreementDetail;
  cycleTitle?: string;
  editing: boolean;
  onEdit: () => void;
  onDoneEditing: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDraft = agreement.status === 'draft';

  function submit() {
    setBusy(true);
    setError(null);
    api
      .POST('/agreements/{agreementId}/submit', { params: { path: { agreementId: agreement.id } } })
      .then((res) => { unwrap(res); onChanged(); })
      .catch((e) => setError(e instanceof ApiError ? thaiMessageFor(e) : 'ส่งข้อตกลงไม่สำเร็จ'))
      .finally(() => setBusy(false));
  }

  return (
    <section style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 16, marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>{cycleTitle ?? 'รอบการประเมิน'}</h2>
      <p className="field-hint" style={{ marginTop: 0 }}>
        สถานะ: {STATUS_LABEL[agreement.status] ?? agreement.status}
        {agreement.form_variant === 'PA1_bs' ? ' · แบบ PA1/บส' : ' · แบบ PA1/ส'}
      </p>

      {error && <div className="field-error" role="alert">{error}</div>}

      {editing ? (
        <AgreementForm
          existing={agreement}
          personnelId={agreement.personnel_id}
          onDone={onDoneEditing}
          onCancel={onDoneEditing}
        />
      ) : (
        <>
          {agreement.challenge ? (
            <>
              <p style={{ fontWeight: 600, marginBottom: 4 }}>{agreement.challenge.title}</p>
              <Field label="วิธีดำเนินการ (20 คะแนน)" value={agreement.challenge.method_plan} />
              <Field label="ผลลัพธ์เชิงปริมาณ (10 คะแนน)" value={agreement.challenge.quantitative_target} />
              <Field label="ผลลัพธ์เชิงคุณภาพ (10 คะแนน)" value={agreement.challenge.qualitative_target} />
            </>
          ) : (
            <div className="alert alert-error" role="alert">
              <span>ยังไม่ได้ระบุประเด็นท้าทาย — ส่งข้อตกลงไม่ได้จนกว่าจะระบุ</span>
            </div>
          )}

          {isDraft && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="btn btn-secondary" onClick={onEdit}>แก้ไข</button>
              <button
                type="button" className="btn btn-primary" onClick={submit}
                disabled={busy || !agreement.challenge}
              >
                {busy ? 'กำลังส่ง…' : 'ส่งข้อตกลง'}
              </button>
            </div>
          )}
          {!isDraft && (
            // Say why it is read-only rather than just disabling the buttons —
            // a frozen form with no explanation reads as a bug.
            <p className="field-hint" style={{ marginTop: 12 }}>
              ส่งแล้วจึงแก้ไขไม่ได้ เพื่อไม่ให้เปลี่ยนเป้าหมายหลังจากที่คณะกรรมการเริ่มพิจารณา
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={{ fontWeight: 600, margin: '0 0 2px', fontSize: '0.875rem' }}>{label}</p>
      {value
        ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{value}</p>
        : <p className="field-hint" style={{ margin: 0 }}>— ยังไม่ได้ระบุ —</p>}
    </div>
  );
}

function AgreementForm({ cycles, existing, personnelId, onDone, onCancel }: {
  cycles?: Cycle[];
  existing?: AgreementDetail;
  personnelId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [cycleId, setCycleId] = useState(existing?.cycle_id ?? '');
  const [title, setTitle] = useState(existing?.challenge?.title ?? '');
  const [methodPlan, setMethodPlan] = useState(existing?.challenge?.method_plan ?? '');
  const [qty, setQty] = useState(existing?.challenge?.quantitative_target ?? '');
  const [quality, setQuality] = useState(existing?.challenge?.qualitative_target ?? '');
  const [targetGroup, setTargetGroup] = useState(existing?.challenge?.target_group ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function save() {
    setError(null);
    if (!existing && !cycleId) return setError('เลือกรอบการประเมิน');
    if (!title.trim()) return setError('ระบุชื่อประเด็นท้าทาย');
    if (!methodPlan.trim()) return setError('ระบุวิธีดำเนินการ');

    const challenge = {
      title: title.trim(),
      method_plan: methodPlan.trim(),
      quantitative_target: qty.trim() || null,
      qualitative_target: quality.trim() || null,
      target_group: targetGroup.trim() || null,
    };

    setBusy(true);
    const req = existing
      ? api.PATCH('/agreements/{agreementId}', {
          params: { path: { agreementId: existing.id } },
          body: { challenge },
        })
      : api.POST('/agreements', {
          body: { cycle_id: cycleId, personnel_id: personnelId, challenge },
        });

    req
      .then((res) => { unwrap(res); onDone(); })
      .catch((e) => setError(e instanceof ApiError ? thaiMessageFor(e) : 'บันทึกไม่สำเร็จ'))
      .finally(() => setBusy(false));
  }

  return (
    <div style={{ border: existing ? 'none' : '1px solid var(--color-border)', borderRadius: 10, padding: existing ? 0 : 16, marginTop: 16 }}>
      {!existing && (
        <div className="field">
          <label htmlFor="agreement-cycle">รอบการประเมิน</label>
          <select id="agreement-cycle" value={cycleId} onChange={(e) => setCycleId(e.target.value)} required>
            <option value="">— เลือก —</option>
            {(cycles ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.title} (ปี {c.fiscal_year})</option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label htmlFor="challenge-title">ประเด็นท้าทาย เรื่อง</label>
        <input id="challenge-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} required />
      </div>
      <div className="field">
        <label htmlFor="challenge-target-group">กลุ่มเป้าหมาย (ไม่บังคับ)</label>
        <input id="challenge-target-group" type="text" value={targetGroup} onChange={(e) => setTargetGroup(e.target.value)} maxLength={500} />
      </div>
      <div className="field">
        <label htmlFor="challenge-method">วิธีดำเนินการ (20 คะแนน)</label>
        <textarea id="challenge-method" rows={5} value={methodPlan} onChange={(e) => setMethodPlan(e.target.value)} maxLength={5000} required />
      </div>
      <div className="field">
        <label htmlFor="challenge-qty">ผลลัพธ์เชิงปริมาณที่คาดหวัง (10 คะแนน)</label>
        <textarea id="challenge-qty" rows={3} value={qty} onChange={(e) => setQty(e.target.value)} maxLength={5000} />
      </div>
      <div className="field">
        <label htmlFor="challenge-quality">ผลลัพธ์เชิงคุณภาพที่คาดหวัง (10 คะแนน)</label>
        <textarea id="challenge-quality" rows={3} value={quality} onChange={(e) => setQuality(e.target.value)} maxLength={5000} />
      </div>

      {error && <div className="field-error" role="alert">{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกร่าง'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>ยกเลิก</button>
      </div>
    </div>
  );
}
