/**
 * School-scoped teardown for integration tests.
 *
 * ## Why this exists
 *
 * Every integration suite shares ONE MySQL, one MinIO bucket and one
 * `worker_job` queue (see the caveat in docs/qa/QUALITY-GATES.md), and until
 * 2026-07-20 essentially none of them deleted what they created. The dev
 * database had accumulated 994 evidence rows and 1830 users, which was tolerable
 * as noise right up until the ADR-0009 re-scan sweep started reading the whole
 * store: test rows registered without ever putting an object in MinIO look
 * exactly like a production file whose bytes were lost. Each one burns 8 worker
 * retries and then sits in the census as an unexplained orphan forever.
 *
 * So this is not tidiness. Leftover fixtures actively degrade a security control
 * that reports on the state of the store.
 *
 * ## Why it is this long
 *
 * There is no cascade shortcut: every relation to `School` is `onDelete:
 * Restrict` on purpose, so a school cannot be dropped while anything references
 * it. The order below is that dependency graph unwound children-first. Relations
 * marked Cascade in schema.prisma are handled by deleting their parent — the
 * explicit steps here are the Restrict ones.
 *
 * ## What is deliberately NOT deleted
 *
 * - **`audit_event`.** A DELETE trigger refuses it (audit immutability,
 *   migration 20260720060003). That is the control working; the rows are an
 *   append-only log and are supposed to outlive the records they describe.
 * - **Shared taxonomy** — `EvidenceCategory`, `RankLevel`, `Indicator`,
 *   `FrameworkVersion`. Suites `upsert` these and run in parallel, so deleting
 *   one would break a sibling mid-run.
 * - **MinIO objects.** Cleaning those is `storage.gc`'s job and needs an S3
 *   client this helper deliberately does not take.
 */

/**
 * Delete everything belonging to the given schools, then the users left with
 * nothing to their name.
 *
 * Safe under parallel test files because each suite creates schools with its own
 * random code and passes only its own ids — nothing here deletes by wildcard.
 *
 * Never throws: teardown must not turn a passing suite red, and a failure here
 * means leftover rows, not a wrong test result. It warns loudly instead.
 */
export async function cleanupSchools(prisma, schoolIds, extraUserIds = []) {
  const ids = [...new Set((schoolIds ?? []).filter(Boolean))];
  const extras = [...new Set((extraUserIds ?? []).filter(Boolean))];
  if (ids.length === 0 && extras.length === 0) return;
  const where = { schoolId: { in: ids } };

  try {
    // Users are collected BEFORE their personnel and memberships are deleted —
    // afterwards there is nothing left to find them by.
    const [personnel, memberships, evidence] = await Promise.all([
      prisma.personnelProfile.findMany({ where, select: { userId: true } }),
      prisma.schoolMembership.findMany({ where, select: { userId: true } }),
      prisma.evidence.findMany({ where, select: { uploadedByUserId: true } }),
    ]);
    // `extras` matters more than it looks. Deriving users from a school's
    // personnel/memberships/evidence misses every user a test creates with NO
    // link to the school — and those are not an edge case, they are the point of
    // the test: `score-foreign-*` proves a non-member cannot score,
    // `session-attacker-*` proves a stranger cannot reuse a session. Two such
    // users leaked per API-suite run until they were tracked explicitly.
    const candidateUserIds = [...new Set([
      ...personnel.map((p) => p.userId),
      ...memberships.map((m) => m.userId),
      ...evidence.map((e) => e.uploadedByUserId),
      ...extras,
    ].filter(Boolean))];

    // Worker jobs are not school-scoped by column, only inside the payload.
    // MySQL Prisma JSON filters take a '$.field' path string, not the Postgres
    // array form (ADR-0008), and only compare one value — hence the loop.
    for (const schoolId of ids) {
      await prisma.workerJob.deleteMany({
        where: { payload: { path: '$.school_id', equals: schoolId } },
      });
    }

    // Dependency order, children first. Each line is here because something
    // Restricts the line below it.
    await prisma.approval.deleteMany({ where });          // Restrict -> School, User
    await prisma.report.deleteMany({ where });            // cascades ReportSectionRef
    await prisma.evaluationAssignment.deleteMany({ where }); // Restrict -> Personnel, Agreement
    await prisma.performanceAgreement.deleteMany({ where }); // cascades AgreementChallenge
    await prisma.evidenceIndicatorMapping.deleteMany({ where }); // Restrict -> Evidence, Cycle
    await prisma.evidence.deleteMany({ where });          // cascades EvidenceFile
    await prisma.evaluationCycle.deleteMany({ where });   // cascades EvaluationRound
    await prisma.personnelProfile.deleteMany({ where });  // Restrict -> User
    await prisma.schoolMembership.deleteMany({ where });
    await prisma.outboxEvent.deleteMany({ where });
    await prisma.school.deleteMany({ where: { id: { in: ids } } });

    // Only users this suite left with nothing. A user shared with a sibling
    // suite still has rows elsewhere and is skipped — checked per user rather
    // than assumed, because assuming is how a parallel run gets flaky.
    for (const userId of candidateUserIds) {
      const [stillPersonnel, stillMember, stillUploaded] = await Promise.all([
        prisma.personnelProfile.count({ where: { userId } }),
        prisma.schoolMembership.count({ where: { userId } }),
        prisma.evidence.count({ where: { uploadedByUserId: userId } }),
      ]);
      if (stillPersonnel === 0 && stillMember === 0 && stillUploaded === 0) {
        await prisma.userAccount.delete({ where: { id: userId } }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn(`[db-cleanup] teardown incomplete, leaving rows behind: ${e?.message ?? e}`);
  }
}

/**
 * Collects school ids as a suite creates them, so the `after()` hook is one line.
 *
 * `add` returns its argument unchanged and accepts either a School row or a bare
 * id, so it wraps a creation site without restructuring it:
 *
 *   const created = trackSchools();
 *   const school = created.add(await prisma.school.create({ ... }));
 *   after(() => cleanupSchools(prisma, created.ids()));
 *
 * Passing it through rather than returning the id matters: a suite that has to
 * rewrite `school.id` into `school` at every use site is a suite where someone
 * eventually forgets one creation site, and a missed site is invisible — the test
 * still passes, it just leaks again.
 */
export function trackSchools() {
  const ids = [];
  const userIds = [];
  return {
    add(schoolOrId) {
      const id = typeof schoolOrId === 'string' ? schoolOrId : schoolOrId?.id;
      if (id) ids.push(id);
      return schoolOrId;
    },
    /** For users a test deliberately leaves unattached to any school — they
     * cannot be found from the school side, so they have to be named here. */
    addUser(userOrId) {
      const id = typeof userOrId === 'string' ? userOrId : userOrId?.id;
      if (id) userIds.push(id);
      return userOrId;
    },
    ids() { return ids; },
    userIds() { return userIds; },
  };
}
