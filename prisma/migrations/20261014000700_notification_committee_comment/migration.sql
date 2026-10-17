-- CCR-028 owner decision A (2026-10-14): NotificationKind is an open enum; a
-- committee comment / request notifies the evaluatee, a reply notifies the author.
ALTER TYPE "NotificationKind" ADD VALUE 'committee_comment';
