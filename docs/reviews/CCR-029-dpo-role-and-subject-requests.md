# CCR-029 — DPO role and the data-subject request register (FR-117)

Status: **DECIDED BY THE OWNER 2026-10-15, APPLIED.**
- Contract: openapi **4.12.0**, permissions **2.11.0** (a policy change: a new role), events **2.3.0**.
- oasdiff finds no breaking change. Every added `Role` and `NotificationKind` value lies inside an open-enum schema, which the compatibility gate excuses (contract-policy.md).

## Owner decisions (2026-10-15)

1. **Who handles requests:** a new `dpo` role, scoped to the area (สพท.) and appointed by the area admin. It is not the area admin itself: FR-096 lists the DPO separately, and keeping data-protection duties apart from system administration is the point. `Role` becomes an open enum (`x-seip-open-enum: true`) under the rule from CCR-028, so this is a minor version, not 5.0.0.
2. **First slice:** the register covers all six request types. Access and portability are fulfilled by the existing portfolio export. The other types are recorded with the DPO's decision and a note, and the actual change is made by hand.

Two other options were offered and declined: the area admin handling requests (an `area_admin_writes` extension), and a 5.0.0 bump with a closed `Role`.

## Contract

| Operation | Who | Notes |
|---|---|---|
| `createSubjectRequest` `POST /subject-requests` | `own`: teacher, deputy, director, school_admin, evaluator | Filed about the caller's own person, to the DPO of the current school's area. No area → VAL-002. Idempotency-Key. |
| `listSubjectRequests` / `getSubjectRequest` | `own` (the caller's requests), `dpo: area` | Nobody else: RES-001, or PERM-001 for a role with no grant at all. Soonest due first. |
| `decideSubjectRequest` `POST /subject-requests/{id}/decision` | `dpo: area`, **min_acr 2** | `approve` / `reject` (note required) / `complete` (note required). Wrong status → VAL-002. Audited. |
| `listAreaDpos` / `appointDpo` `…/areas/{areaId}/dpos` | area_admin (`area-r` / `area`); appointDpo joins `area_admin_writes`, **min_acr 2** | An area-scoped `dpo` membership, invited like appointSchoolAdmin. Another area → RES-001. |

**Lifecycle:**
- `received` → `approve`:
  - access / portability: → `fulfilling`. A `portfolio_portable` export for the person is queued in the same transaction. When `export.ready` is dispatched, the request becomes `completed`.
  - other types: → `approved`, then `complete` with a note → `completed`.
- `received` or `approved` → `reject` with a reason → `rejected`.
- `due_at` = received + 30 days (NFR-PDPA-05, **unverified**). `overdue` is shown as a warning and never blocks anything.

**Events:**
- `subject_request.created` notifies the area's DPOs (`subject_request_received`, route `/dpo/requests`).
- `subject_request.decided` notifies the person (`subject_request_updated`, route `/privacy-requests`).
- Neither the events nor the notification texts carry the details or the DPO's note.

## What a DPO can and cannot do

- **Can:** read and decide the requests of their own area.
- **Cannot:**
  - read evidence, members, coverage or anything else at a school; every such operation is PERM-001, and the permission sweep checks this for every operation.
  - download the export they approved (it is the person's, PERM-001).
  - file a request (no person route).
- Another area's requests are RES-001.

Two supporting changes:
- **School header:** `X-School-Id` naming a school in the DPO's area is accepted, but only to pick the context, as for area_admin; every route still checks a grant.
- **Denials:** a role with no grant at all now gets PERM-001 on routes that previously answered RES-001 for "no foothold". These are evidence, uploads, coverage, committee and exports, and an area role over the school's area now counts as a foothold.

## Data

- Table `subject_request` (migration `20261015000100_subject_request`).
- CHECKs:
  - a decided request has an actor and a time;
  - a rejection has a reason;
  - `due_at` ≥ `received_at`.
- RLS backstop: the person in scope, or the area in scope.
- Audit allowlist `SubjectRequest`: id, personId, areaId, requestType, status, exportId. Details and notes stay on the row.

## Verified

- `apps/api/test/subject-requests.test.mjs` (4 tests):
  - visibility;
  - 30-day due date;
  - VAL-002 at a school with no area;
  - DPO notification only within the area;
  - no details in audit;
  - access → export → auto-complete;
  - the DPO cannot see the export;
  - erasure approve → complete with note;
  - reject with reason;
  - overdue;
  - appointDpo / listAreaDpos;
  - the DPO reads no school data.
- `test:security`: the sweep now includes the `dpo` role on every operation.
- `step-up.test.mjs`: appointDpo and decideSubjectRequest.
- e2e `privacy-requests.spec`: the teacher files an access request, the DPO approves in a separate browser, and the teacher sees it completed with a link to the export.

## Not done

- Carrying out correction, erasure, restriction and objection in the system. They are done by hand and recorded here; erasure has retention rules (FR-117 "under the retention period") still to design.
- A DPO approval step before the person's own self-service export: self-service stays (SEIP-P5-001).
- Email delivery. Due-date reminders were added the same day, with no contract change. The hourly `reminders.run` worker job tells the area's DPOs once per milestone: 7 days, 1 day and overdue. It uses the existing `deadline` kind and is tested in `apps/worker/test/reminders.test.mjs`.
- Revoking a DPO appointment, other than ending the membership in the database.
