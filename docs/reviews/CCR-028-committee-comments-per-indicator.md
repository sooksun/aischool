# CCR-028: committee comments per indicator (additive)

Status: **APPLIED 2026-10-14.** The change is additive, so it takes a minor bump. It implements FR-064 as the PRD writes it: comments and requests for more information, **no score**, and the evaluatee sees them and replies. Nothing changes a mapping or an evaluation.
Task: `SEIP-P4-006` · Requirement: FR-064 · Shipped: openapi **4.10.0**, permissions **2.10.0**, events **2.1.0**

## What changed

- `GET /assignments/{assignmentId}/comments` (listAssignmentComments) and `POST …/comments` (createAssignmentComment).
- The schemas `AssignmentComment` and `AssignmentCommentCreate` hold:
  - `kind`: comment, request_info or reply
  - `body`: plain text, 1–2000 characters
  - `parent_id`: required on a reply, and only on a reply
  - `author_role`: committee, director or evaluatee
- Permissions:
  - The evaluatee (`own`) reads, and posts **replies only**, to a comment on the same indicator.
  - A member of **this** committee (`committee`) reads and posts while the round is open. A seat counts only for a role the matrix grants `committee` (evaluator, director); a seat alone is not a grant. Once the round closes it is PERM-003, as in FR-062b.
  - The director (`school`) reads and posts.
  - The school admin (`school`) reads only.
  - Others on the school's staff get PERM-001. Anyone without a foothold at the school gets RES-001.
- Event `assignment.comment.created` carries `{assignment_id, comment_id, indicator_id, kind}`. The body is never copied into it.
- Table `assignment_comment` with CHECKs (body length; reply ⇔ parent), FKs and an RLS backstop policy by school.
- On the web, every indicator on the committee page gets a thread with a "ความเห็น / ขอข้อมูลเพิ่ม" form. The evaluatee's page `/assignments/{id}/comments` shows each indicator with a reply box.

## Notifying about comments

FR-064 also asks that the evaluatee be notified. That needs a new `NotificationKind` value. Adding an enum value to a response is **breaking** under contract-policy: `oasdiff` reports `response-property-enum-value-added`, and the compatibility gate fails it without a major bump. So it was left out of the 4.10.0 change.

**Decided by the owner, 2026-10-14: option A.** `NotificationKind` becomes an open enum (`x-seip-open-enum: true`) and gains `committee_comment` in **4.11.0** (events 2.2.0), with no major bump. The compatibility gate excuses only a new value whose oasdiff source line falls inside an open-enum schema, and a value added to any other enum still fails (checked by hand against ExportPackage.status). The rule is in contract-policy.md. The two other options were B, a major bump to 5.0.0, and C, no notification.

Applied the same day: the notification consumer joins `assignment.comment.created`. A comment or request notifies the evaluatee, routed to `/assignments/{id}/comments`. A reply notifies the author of its parent, routed to `/assignments/{id}/evidence`. The actor is never notified, and the text never carries the body. Neither the web nor the app branches on `kind`, and the generated Dart client already has `$unknown`.

## Verified

- `apps/api/test/coverage.test.mjs` (+1). It covers:
  - a request from a committee member at another school, and a comment from the director
  - the evaluatee reads both and replies; the evaluatee cannot open a thread; a reply needs its parent and the parent's indicator
  - a peer gets 403, a stranger 404, an off-committee evaluator PERM-003
  - the event carries no body
  - after the round closes, the committee gets PERM-003 and the evaluatee still reads
- `test:security` sweeps both operations for every role. The sweep found that a school admin with a committee seat could post, and that was fixed.
