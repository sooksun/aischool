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

## Deliberately not included: notifying about comments

FR-064 also asks that the evaluatee be notified. That needs a new `NotificationKind` value. Adding an enum value to a response is **breaking** under contract-policy: `oasdiff` reports `response-property-enum-value-added`, and the compatibility gate fails it without a major bump. So it is left out of this additive change.

**Decision needed from the owner:** approve adding `committee_comment` to `NotificationKind`, as a major bump to 5.0.0, or as an agreed exception to the enum rule. Once that is approved, the notification consumer joins `assignment.comment.created`: a comment or request notifies the evaluatee, and a reply notifies the comment's author.

## Verified

- `apps/api/test/coverage.test.mjs` (+1). It covers:
  - a request from a committee member at another school, and a comment from the director
  - the evaluatee reads both and replies; the evaluatee cannot open a thread; a reply needs its parent and the parent's indicator
  - a peer gets 403, a stranger 404, an off-committee evaluator PERM-003
  - the event carries no body
  - after the round closes, the committee gets PERM-003 and the evaluatee still reads
- `test:security` sweeps both operations for every role. The sweep found that a school admin with a committee seat could post, and that was fixed.
