// School member administration (CCR-014 / SEIP-BLOCK-001).
//
// This page is the reason a fresh install can be used at all: before it, the
// only account that could exist was whatever the operator created with
// scripts/ops/bootstrap-admin.mjs, and there was no way to add a second person.
//
// The invite token is shown ONCE, on creation, and is not retrievable
// afterwards — the server only stores its hash. The UI has to make that
// impossible to miss, because an admin who closes the panel has to re-invite.
import { useEffect, useState } from 'react';
import { api, unwrap } from '../../api/client';
import { ApiError, thaiMessageFor } from '../../api/errors';
import type { components } from '../../api/schema.generated';

type Member = components['schemas']['Member'];
type Role = components['schemas']['Role'];

// area_admin is absent on purpose: it is an area-scoped role and the API rejects
// it here with VAL-002 (a school membership row would violate the
// membership_scope_ids CHECK).
const INVITABLE_ROLES: { value: Role; label: string }[] = [
  { value: 'teacher', label: 'ครู' },
  { value: 'deputy', label: 'รองผู้อำนวยการ' },
  { value: 'director', label: 'ผู้อำนวยการ' },
  { value: 'evaluator', label: 'กรรมการประเมิน' },
  { value: 'school_admin', label: 'ผู้ดูแลระบบโรงเรียน' },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(INVITABLE_ROLES.map((r) => [r.value, r.label]));
ROLE_LABEL.area_admin = 'เขตพื้นที่';

const USER_STATUS_LABEL: Record<string, string> = {
  active: 'ใช้งานได้',
  invited: 'รอตั้งรหัสผ่าน',
  disabled: 'ระงับการใช้งาน',
};

// Only roles that are evaluated need a PersonnelProfile. An external committee
// evaluator belongs to the school without being evaluated by it — the same
// reason CurrentUser.personnel is nullable (CCR-002).
const EVALUATED_ROLES = new Set<Role>(['teacher', 'deputy', 'director']);

interface RankOption { code: string; label: string; family: 'teacher' | 'administrator' }

export function MembersPage() {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [issued, setIssued] = useState<{ email: string; token: string; expiresAt: string } | null>(null);
  const [ranks, setRanks] = useState<RankOption[]>([]);

  function reload() {
    setMembers(null);
    setLoadError(null);
    api
      .GET('/members', { params: { query: {} } })
      .then((res) => setMembers(unwrap(res)))
      .catch((e) => setLoadError(e instanceof ApiError ? thaiMessageFor(e) : 'โหลดรายชื่อไม่สำเร็จ'));
  }

  useEffect(reload, []);

  // Rank codes are seeded taxonomy (ADR-0003), never hard-coded here — they come
  // from the active frameworks' indicator level rows.
  useEffect(() => {
    api
      .GET('/frameworks', { params: { query: { status: 'active' } } })
      .then((res) => {
        const frameworks = unwrap(res);
        return Promise.all(
          frameworks.map((f) =>
            api.GET('/frameworks/{frameworkId}', {
              params: { path: { frameworkId: f.id }, query: { include: 'levels' } },
            }),
          ),
        );
      })
      .then((results) => {
        const seen = new Map<string, RankOption>();
        for (const res of results) {
          const detail = unwrap(res);
          for (const domain of detail.domains ?? []) {
            for (const indicator of domain.indicators ?? []) {
              for (const level of indicator.levels ?? []) {
                if (!seen.has(level.rank_level_code)) {
                  seen.set(level.rank_level_code, {
                    code: level.rank_level_code,
                    label: level.rank_level_code,
                    family: detail.role_family,
                  });
                }
              }
            }
          }
        }
        setRanks([...seen.values()]);
      })
      .catch(() => setRanks([])); // degraded: the field falls back to free text
  }, []);

  return (
    <main className="page">
      <h1>บุคลากรและสิทธิ์การใช้งาน</h1>
      <p className="field-hint">
        เชิญครูและกรรมการเข้าใช้ระบบ ระบบจะสร้างรหัสเชิญให้หนึ่งครั้ง นำไปส่งต่อให้เจ้าตัวตั้งรหัสผ่านเอง
      </p>

      {issued && <IssuedTokenPanel issued={issued} onDismiss={() => setIssued(null)} />}

      <button type="button" className="btn btn-primary" onClick={() => setShowInvite((v) => !v)}>
        {showInvite ? 'ยกเลิก' : '+ เชิญบุคลากร'}
      </button>

      {showInvite && (
        <InviteForm
          ranks={ranks}
          onDone={(result) => {
            setShowInvite(false);
            if (result) setIssued(result);
            reload();
          }}
        />
      )}

      {members === null && !loadError && <p className="field-hint">กำลังโหลด…</p>}
      {loadError && (
        <div className="alert alert-error" role="alert">
          <span>{loadError}</span>
          <button type="button" className="btn btn-secondary" onClick={reload}>ลองใหม่</button>
        </div>
      )}

      {members?.length === 0 && (
        <div className="empty-state">
          <p>ยังไม่มีบุคลากรในระบบ</p>
          <p className="field-hint">เริ่มจากเชิญครูคนแรกด้วยปุ่มด้านบน</p>
        </div>
      )}

      {members && members.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: `16px 0 0` }}>
          {members.map((m) => (
            <MemberRow key={m.membership_id} member={m} onChanged={reload} />
          ))}
        </ul>
      )}
    </main>
  );
}

function IssuedTokenPanel({ issued, onDismiss }: {
  issued: { email: string; token: string; expiresAt: string };
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="alert alert-success" role="status" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
      <strong>เชิญ {issued.email} เรียบร้อย</strong>
      <p style={{ margin: '8px 0' }}>
        ส่งรหัสเชิญนี้ให้เจ้าตัว <b>รหัสนี้แสดงเพียงครั้งเดียว</b> ถ้าปิดหน้านี้แล้วจะดูย้อนหลังไม่ได้
        ต้องเชิญใหม่
      </p>
      <code style={{ display: 'block', padding: 12, background: '#fff', borderRadius: 8, wordBreak: 'break-all' }}>
        {issued.token}
      </code>
      <p className="field-hint">หมดอายุ {new Date(issued.expiresAt).toLocaleString('th-TH')}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(issued.token).then(() => setCopied(true));
          }}
        >
          {copied ? 'คัดลอกแล้ว' : 'คัดลอกรหัส'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onDismiss}>ปิด</button>
      </div>
    </div>
  );
}

function MemberRow({ member, onChanged }: { member: Member; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function end() {
    setBusy(true);
    setError(null);
    api
      .POST('/members/{membershipId}/end', { params: { path: { membershipId: member.membership_id } } })
      .then((res) => {
        unwrap(res);
        onChanged();
      })
      .catch((e) => setError(e instanceof ApiError ? thaiMessageFor(e) : 'สิ้นสุดสิทธิ์ไม่สำเร็จ'))
      .finally(() => {
        setBusy(false);
        setConfirming(false);
      });
  }

  return (
    <li className="evidence-card">
      <div className="title">{member.personnel?.full_name ?? member.display_name}</div>
      <p className="field-hint" style={{ margin: 0 }}>{member.email}</p>
      <p className="field-hint" style={{ margin: '4px 0 0' }}>
        {ROLE_LABEL[member.role] ?? member.role}
        {' · '}
        <span className="status-badge">
          <span className="status-dot" data-state={member.user_status === 'active' ? 'clean' : 'pending'} />
          {USER_STATUS_LABEL[member.user_status] ?? member.user_status}
        </span>
        {member.personnel && ` · ${member.personnel.rank_level_code}`}
      </p>

      {error && <div className="field-error" role="alert">{error}</div>}

      {!confirming && (
        <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => setConfirming(true)}>
          สิ้นสุดสิทธิ์
        </button>
      )}
      {confirming && (
        <div style={{ marginTop: 8 }}>
          {/* Offboarding, not deletion — say so, because "ลบ" would imply the
              person's evaluation history disappears with them. It does not. */}
          <p className="field-hint">
            ยืนยันสิ้นสุดสิทธิ์ของ {member.email}? ประวัติการประเมินจะยังอยู่ครบ แต่จะเข้าใช้ระบบไม่ได้อีก
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={end} disabled={busy}>
              {busy ? 'กำลังบันทึก…' : 'ยืนยัน'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function InviteForm({ ranks, onDone }: {
  ranks: RankOption[];
  onDone: (issued: { email: string; token: string; expiresAt: string } | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('teacher');
  const [fullName, setFullName] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [rankLevelCode, setRankLevelCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsPersonnel = EVALUATED_ROLES.has(role);
  const family: 'teacher' | 'administrator' = role === 'teacher' ? 'teacher' : 'administrator';
  const rankOptions = ranks.filter((r) => r.family === family);

  function submit() {
    setError(null);
    if (!email.trim()) return setError('กรอกอีเมล');
    if (!displayName.trim()) return setError('กรอกชื่อที่แสดงในระบบ');
    if (needsPersonnel) {
      if (!fullName.trim()) return setError('กรอกชื่อ-นามสกุล');
      if (!rankLevelCode.trim()) return setError('เลือกวิทยฐานะ');
    }

    setBusy(true);
    api
      .POST('/members', {
        body: {
          email: email.trim(),
          display_name: displayName.trim(),
          role,
          ...(needsPersonnel
            ? {
                personnel: {
                  full_name: fullName.trim(),
                  employee_code: employeeCode.trim() || null,
                  position_role: family,
                  rank_level_code: rankLevelCode,
                },
              }
            : {}),
        },
      })
      .then((res) => {
        const created = unwrap(res);
        onDone(
          created.invite_token && created.invite_expires_at
            ? { email: created.member.email, token: created.invite_token, expiresAt: created.invite_expires_at }
            : null,
        );
      })
      .catch((e) => setError(e instanceof ApiError ? thaiMessageFor(e) : 'เชิญบุคลากรไม่สำเร็จ'))
      .finally(() => setBusy(false));
  }

  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 16, marginTop: 16 }}>
      <div className="field">
        <label htmlFor="invite-email">อีเมล</label>
        <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="invite-name">ชื่อที่แสดงในระบบ</label>
        <input id="invite-name" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={200} required />
      </div>
      <div className="field">
        <label htmlFor="invite-role">บทบาท</label>
        <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {INVITABLE_ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        {!needsPersonnel && (
          <p className="field-hint">กรรมการประเมินและผู้ดูแลระบบไม่ต้องมีข้อมูลบุคลากร เพราะไม่ได้เป็นผู้รับการประเมิน</p>
        )}
      </div>

      {needsPersonnel && (
        <>
          <div className="field">
            <label htmlFor="invite-fullname">ชื่อ-นามสกุล</label>
            <input id="invite-fullname" type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={200} required />
          </div>
          <div className="field">
            <label htmlFor="invite-empcode">เลขประจำตัว (ไม่บังคับ)</label>
            <input id="invite-empcode" type="text" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} maxLength={50} />
          </div>
          <div className="field">
            <label htmlFor="invite-rank">วิทยฐานะ</label>
            {rankOptions.length > 0 ? (
              <select id="invite-rank" value={rankLevelCode} onChange={(e) => setRankLevelCode(e.target.value)}>
                <option value="">— เลือก —</option>
                {rankOptions.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </select>
            ) : (
              <input id="invite-rank" type="text" value={rankLevelCode} onChange={(e) => setRankLevelCode(e.target.value)} />
            )}
            <p className="field-hint">เลือกวิทยฐานะให้ตรงกับสายงาน ระบบใช้ค่านี้เลือกเกณฑ์ ว9/ว10</p>
          </div>
        </>
      )}

      {error && <div className="field-error" role="alert">{error}</div>}

      <button type="button" className="btn btn-primary btn-full" onClick={submit} disabled={busy}>
        {busy ? 'กำลังเชิญ…' : 'เชิญเข้าใช้ระบบ'}
      </button>
    </div>
  );
}
