-- CCR-028 (FR-064): committee comments per indicator and the evaluatee's replies.
-- CreateEnum
CREATE TYPE "AssignmentCommentKind" AS ENUM ('comment', 'request_info', 'reply');

-- CreateEnum
CREATE TYPE "AssignmentCommentAuthorRole" AS ENUM ('committee', 'director', 'evaluatee');

-- CreateTable
CREATE TABLE "assignment_comment" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "school_id" UUID NOT NULL,
    "indicator_id" UUID NOT NULL,
    "kind" "AssignmentCommentKind" NOT NULL,
    "body" TEXT NOT NULL,
    "parent_id" UUID,
    "author_user_id" UUID NOT NULL,
    "author_role" "AssignmentCommentAuthorRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_comment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignment_comment_assignment_id_indicator_id_created_at_idx" ON "assignment_comment"("assignment_id", "indicator_id", "created_at");


ALTER TABLE assignment_comment ADD CONSTRAINT assignment_comment_assignment_fk
  FOREIGN KEY (assignment_id) REFERENCES evaluation_assignment(id) ON DELETE CASCADE;
ALTER TABLE assignment_comment ADD CONSTRAINT assignment_comment_parent_fk
  FOREIGN KEY (parent_id) REFERENCES assignment_comment(id) ON DELETE CASCADE;
ALTER TABLE assignment_comment ADD CONSTRAINT assignment_comment_body_ck CHECK (char_length(body) BETWEEN 1 AND 2000);
ALTER TABLE assignment_comment ADD CONSTRAINT assignment_comment_reply_ck CHECK ((kind = 'reply') = (parent_id IS NOT NULL));

-- RLS backstop (ADR-0019): a school in scope sees its assignments' comments.
ALTER TABLE assignment_comment ENABLE ROW LEVEL SECURITY;
CREATE POLICY assignment_comment_area_backstop ON assignment_comment
  USING (current_user <> 'seip_scoped' OR school_id = ANY (seip_scope_school_ids()));

