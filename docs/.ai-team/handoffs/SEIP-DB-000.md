# Handoff: SEIP-DB-000

## Owner
codex

## Reviewer
grok

## Objective
Produce stack-agnostic ERD + entity dictionary for SEIP, record audit-history choice, surface OPEN-4 storage assumption, and give backend-feasibility verdict on contracts v0.1.

## Board / process notes
| Check | Result |
|---|---|
| Owner is `codex` | Yes |
| Status on task-board | **`blocked`** (not `ready`) — depends on SEIP-ARCH-001 |
| Branch `ai/codex/SEIP-DB-000-data-model` | **Not created** — workspace is not a git repository (SEIP-OPS-001 pending) |
| File locks | Registered in `.ai-team/file-locks.yaml` |
| Contracts v0.1 | **Absent** — CCR-001 filed |

Work proceeded on path locks only, per user dispatch, using closed domain inputs (ADR-0003 + evaluation-framework).

## Files Created
| Path | Role |
|---|---|
| `docs/architecture/data-model/README.md` | Design principles, audit choice, OPEN questions |
| `docs/architecture/data-model/erd.mmd` | Mermaid ERD |
| `docs/architecture/data-model/entity-dictionary.md` | Full dictionary + constraint intentions |
| `docs/reviews/SEIP-DB-000-feasibility.md` | Feasibility findings for Grok |
| `docs/reviews/CCR-001-contracts-v0.1-missing.md` | Contract Change Request |
| `.ai-team/handoffs/SEIP-DB-000.md` | This handoff |

## Files Modified
| Path | Change |
|---|---|
| `.ai-team/file-locks.yaml` | Lock SEIP-DB-000 paths |

## Entity list (summary)
Area, School, UserAccount, SchoolMembership, RankLevel, PersonnelProfile, FrameworkVersion, EvaluationDomain, Indicator, IndicatorLevelDescription, ScoreWeight, EvidenceCategory, EvaluationCycle, EvaluationRound, PerformanceAgreement, WorkloadDeclaration, AgreementChallenge, Evidence, EvidenceFile, EvidenceIndicatorMapping, EvaluationAssignment, CommitteeMember, IndicatorScore, ChallengeScore, RoundResult, Report, ReportSectionRef, Approval, AuditEvent.

## Audit-history approach
**Append-only `AuditEvent` table** (event-sourcing lite) + domain status/soft-delete fields.  
Rejected full temporal tables (heavy for Sprint 1) and soft-delete-only (insufficient accountability).  
App role must not UPDATE/DELETE audit rows (enforce in SEIP-DB-001).

## OPEN-2 / OPEN-4 assumptions
| ID | Status | Assumption in this design |
|---|---|---|
| OPEN-2 | **Closed** (ADR-0003) | Taxonomy T-x.x / A-x.x as versioned data per evaluation-framework.md |
| OPEN-4 | **Open** | Evidence files: `storage_provider` + `storage_uri` only; no binary in Postgres; provider undecided |

## Contract Impact
- **No edits** to `docs/contracts/**` (blocked path).
- **CCR-001**: contracts v0.1 missing — cannot complete field-level feasibility.
- Did **not** invent OpenAPI fields or DTOs.

## Database Impact
- Design only. **No** `prisma/schema.prisma`, **no** migrations, **no** apps/** code.
- Constraint intentions documented for SEIP-DB-001.

## Feasibility verdict (contracts v0.1)
**BLOCKED — MISSING INPUT.** Domain model is feasible; contract loop incomplete until ARCH-001. See `docs/reviews/SEIP-DB-000-feasibility.md`.

## Tests and Results
None executed (design task). Constraint intentions stated in entity dictionary.

## Verification Commands
```text
# From repo root D:\laragon\www\aischool

ls docs/architecture/data-model/
# Expected: README.md, erd.mmd, entity-dictionary.md

npx --yes @mermaid-js/mermaid-cli -i docs/architecture/data-model/erd.mmd -o docs/architecture/data-model/erd.svg
# Expected: exit 0 and erd.svg created
```

Results recorded at handoff time:

```text
(see agent session — commands run and exit codes captured below in "Verification results")
```

## Known Limitations
1. Task-board still `blocked`; dependency SEIP-ARCH-001 not approved.
2. No git branch.
3. AC5 (contract feasibility) incomplete pending CCR-001.
4. Official PA1/PA2/PA3 field inventory not modelled field-by-field (`Report.payload` JSON + template_code).
5. AI-mapping persistence deferred (Sprint 2 / OPEN-5).
6. Paths currently live under `docs/.ai-team/**` until SEIP-OPS-001 canonicalizes root layout (ADR-0002).

## Acceptance criteria self-check
| AC | Met? |
|---|---|
| 1 ERD covers school…audit | Yes |
| 1a Framework taxonomy + per-evaluator + workload + weights | Yes |
| 2 Upload once / governed mappings | Yes (`Evidence` + `EvidenceIndicatorMapping` + `ReportSectionRef`) |
| 3 Audit choice explicit | Yes (append-only AuditEvent) |
| 4 Dictionary every entity | Yes |
| 5 Feasibility on contracts v0.1 | **Partial / blocked** — CCR-001 |
| 6 Open questions listed | Yes |

## Recommended Next Task
1. Claude: SEIP-OPS-001 → SEIP-ARCH-001 (unblock contracts).
2. Codex: amend feasibility when v0.1 exists (close CCR-001 or open field CCRs).
3. Grok: review this design in SEIP-QA-002 (domain now; contracts later).
4. Sprint 1: SEIP-DB-001 implements Prisma from this dictionary after contract lock.

## Verification results
_Filled by agent after running commands._
