-- FR-012 / CCR-026: the owner's earlier file with the same verified bytes.
ALTER TABLE "evidence_file" ADD COLUMN "duplicate_of_file_id" UUID;
ALTER TABLE "evidence_file" ADD CONSTRAINT "evidence_file_duplicate_of_file_id_fkey"
  FOREIGN KEY ("duplicate_of_file_id") REFERENCES "evidence_file"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "evidence_file_checksum_sha256_idx" ON "evidence_file"("checksum_sha256");
