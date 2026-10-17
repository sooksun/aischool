// FR-065: a read-only committee view in the app. A committee member (evaluator)
// or the director sees the assignments of the open rounds and, for one of them,
// the evaluatee's confirmed evidence per indicator — the same data as the web's
// committee page (listAssignmentEvidence). Nothing here validates, returns or
// comments; that stays on the web. No AI confidence or rationale is shown
// (FR-061): only where a mapping came from (FR-047).
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:seip_api/seip_api.dart';

/// Roles the matrix grants the committee view to (permissions.yaml listAssignmentEvidence).
bool canSeeCommitteeView(CurrentUser me) =>
    me.memberships.any((m) => m.role == Role.evaluator || m.role == Role.director);

String provenanceTh(MappingSource s) => s == MappingSource.aiAccepted ? 'AI เสนอ · ยืนยันโดยเจ้าของ' : 'เจ้าของเพิ่มเอง';

String mappingStatusTh(MappingStatus s) => switch (s) {
      MappingStatus.validated => 'รับรองแล้ว',
      MappingStatus.returned => 'ถูกส่งกลับ',
      _ => 'รอรับรอง',
    };

class CommitteeAssignment {
  const CommitteeAssignment({required this.assignment, required this.evaluateeName, required this.label});
  final Assignment assignment;
  final String evaluateeName;
  final String label;
}

/// The assignments of every open or scoring round in the caller's cycles. The
/// server decides which ones the caller may see; names are best effort.
Future<List<CommitteeAssignment>> loadCommitteeAssignments(SeipApi api) async {
  final names = <String, String>{};
  try {
    for (final p in await api.members.listPersonnel()) {
      names[p.id] = p.fullName;
    }
  } catch (_) {
    // A committee member from another school cannot list its staff: show a generic label.
  }
  final out = <CommitteeAssignment>[];
  for (final cycle in await api.cycles.listCycles()) {
    final detail = await api.cycles.getCycle(cycleId: cycle.id);
    for (final round in detail.rounds.where((r) => r.status == 'open' || r.status == 'scoring')) {
      final page = await api.scoring.listAssignments(roundId: round.id, pageSize: 100);
      for (final a in page.items) {
        out.add(CommitteeAssignment(
          assignment: a,
          evaluateeName: names[a.evaluateePersonnelId] ?? 'ผู้รับการประเมิน',
          label: '${detail.title} · รอบที่ ${round.roundNumber}',
        ));
      }
    }
  }
  return out;
}

class CommitteeScreen extends StatefulWidget {
  const CommitteeScreen({super.key, required this.api});
  final SeipApi api;

  @override
  State<CommitteeScreen> createState() => _CommitteeScreenState();
}

class _CommitteeScreenState extends State<CommitteeScreen> {
  late Future<List<CommitteeAssignment>> _items = loadCommitteeAssignments(widget.api);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('งานกรรมการ')),
      body: RefreshIndicator(
        onRefresh: () async => setState(() => _items = loadCommitteeAssignments(widget.api)),
        child: FutureBuilder<List<CommitteeAssignment>>(
          future: _items,
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
            if (snap.hasError) {
              return ListView(children: const [Padding(padding: EdgeInsets.all(16), child: Text('โหลดไม่สำเร็จ ลากลงเพื่อลองใหม่', key: Key('committeeError')))]);
            }
            final items = snap.data!;
            if (items.isEmpty) {
              return ListView(children: const [Padding(padding: EdgeInsets.all(16), child: Text('ไม่มีการประเมินที่เปิดอยู่', key: Key('committeeEmpty')))]);
            }
            return ListView(children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
                child: Text('ดูได้อย่างเดียว — การรับรอง ส่งกลับ และความเห็น ทำบนเว็บ'),
              ),
              for (final it in items)
                ListTile(
                  key: Key('assignment-${it.assignment.id}'),
                  title: Text(it.evaluateeName),
                  subtitle: Text(it.label),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(
                    builder: (_) => CommitteeEvidenceScreen(api: widget.api, assignmentId: it.assignment.id, evaluateeName: it.evaluateeName),
                  )),
                ),
            ]);
          },
        ),
      ),
    );
  }
}

class IndicatorEvidence {
  const IndicatorEvidence({required this.code, required this.name, required this.items});
  final String code;
  final String name;
  final List<AssignmentEvidenceItem> items;
}

/// Every page of the committee view, grouped by indicator in framework order.
Future<List<IndicatorEvidence>> loadCommitteeEvidence(SeipApi api, String assignmentId) async {
  final all = <AssignmentEvidenceItem>[];
  String? cursor;
  for (var i = 0; i < 20; i++) {
    final page = await api.scoring.listAssignmentEvidence(assignmentId: assignmentId, limit: 100, cursor: cursor);
    all.addAll(page.items);
    cursor = page.nextCursor;
    if (cursor == null) break;
  }
  if (all.isEmpty) return const [];
  final order = <String, (int, String, String)>{};
  try {
    final fw = await api.taxonomy.getFramework(frameworkId: all.first.mapping.frameworkVersionId);
    var n = 0;
    for (final d in fw.domains) {
      for (final ind in d.indicators) {
        order[ind.id] = (n++, ind.code, ind.nameTh);
      }
    }
  } catch (_) {
    // Without the framework the groups still show, keyed by id.
  }
  final groups = <String, List<AssignmentEvidenceItem>>{};
  for (final it in all) {
    (groups[it.indicatorId] ??= []).add(it);
  }
  final ids = groups.keys.toList()..sort((a, b) => (order[a]?.$1 ?? 1 << 30).compareTo(order[b]?.$1 ?? 1 << 30));
  return [
    for (final id in ids) IndicatorEvidence(code: order[id]?.$2 ?? 'ตัวชี้วัด', name: order[id]?.$3 ?? '', items: groups[id]!),
  ];
}

class CommitteeEvidenceScreen extends StatefulWidget {
  const CommitteeEvidenceScreen({super.key, required this.api, required this.assignmentId, required this.evaluateeName});
  final SeipApi api;
  final String assignmentId;
  final String evaluateeName;

  @override
  State<CommitteeEvidenceScreen> createState() => _CommitteeEvidenceScreenState();
}

class _CommitteeEvidenceScreenState extends State<CommitteeEvidenceScreen> {
  late final Future<List<IndicatorEvidence>> _groups = loadCommitteeEvidence(widget.api, widget.assignmentId);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('หลักฐาน · ${widget.evaluateeName}')),
      body: FutureBuilder<List<IndicatorEvidence>>(
        future: _groups,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) {
            final e = snap.error;
            // PERM-003: not on this committee, or the round has closed (FR-062b).
            final closed = e is DioException && e.response?.statusCode == 403;
            return Padding(
              padding: const EdgeInsets.all(16),
              child: Text(closed ? 'สิทธิ์ดูหลักฐานของการประเมินนี้สิ้นสุดแล้ว' : 'โหลดไม่สำเร็จ', key: const Key('committeeEvidenceError')),
            );
          }
          final groups = snap.data!;
          if (groups.isEmpty) {
            return const Padding(padding: EdgeInsets.all(16), child: Text('ยังไม่มีหลักฐานที่ผู้รับการประเมินยืนยัน', key: Key('committeeEvidenceEmpty')));
          }
          return ListView(children: [
            for (final g in groups) ...[
              ListTile(
                key: Key('indicator-${g.code}'),
                title: Text(g.code, style: Theme.of(context).textTheme.titleMedium),
                subtitle: g.name.isEmpty ? null : Text(g.name),
              ),
              for (final it in g.items)
                ListTile(
                  key: Key('evidence-${it.evidence.id}'),
                  contentPadding: const EdgeInsets.only(left: 32, right: 16),
                  title: Text(it.evidence.title),
                  subtitle: Text([
                    provenanceTh(it.mapping.mappingSource),
                    mappingStatusTh(it.mapping.status),
                    'ไฟล์ ${it.files.length}',
                  ].join(' · ')),
                ),
              const Divider(),
            ],
          ]);
        },
      ),
    );
  }
}
