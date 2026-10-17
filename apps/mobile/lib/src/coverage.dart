// FR-053: the coverage summary on the app's home screen — how many of the
// person's framework indicators still have no confirmed evidence, and how many
// suggestions wait. Counts only; the full table is on the web.
import 'package:flutter/material.dart';
import 'package:seip_api/seip_api.dart';

class CoverageSummary {
  const CoverageSummary({required this.total, required this.empty, required this.waiting, required this.openSuggestions});
  final int total;
  final int empty;
  final int waiting;
  final int openSuggestions;

  static CoverageSummary of(CoverageReport r) => CoverageSummary(
        total: r.indicators.length,
        empty: r.indicators.where((i) => i.validated + i.ownerConfirmed == 0).length,
        waiting: r.indicators.fold(0, (n, i) => n + i.ownerConfirmed),
        openSuggestions: r.indicators.fold(0, (n, i) => n + i.openSuggestions),
      );
}

Future<CoverageSummary?> loadCoverageSummary(SeipApi api, CurrentUser me) async {
  final personId = me.personId;
  if (personId == null) return null;
  final frameworks = await api.taxonomy.listFrameworks(
    roleFamily: me.personnel?.positionRole ?? RoleFamily.teacher,
    status: Status3.active,
  );
  if (frameworks.isEmpty) return null;
  final report = await api.coverage.getCoverage(
    subjectType: SubjectType.person,
    subjectId: personId,
    frameworkVersionId: frameworks.first.id,
  );
  return CoverageSummary.of(report);
}

class CoverageCard extends StatefulWidget {
  const CoverageCard({super.key, required this.api, required this.me});
  final SeipApi api;
  final CurrentUser me;

  @override
  State<CoverageCard> createState() => _CoverageCardState();
}

class _CoverageCardState extends State<CoverageCard> {
  CoverageSummary? _summary;

  @override
  void initState() {
    super.initState();
    loadCoverageSummary(widget.api, widget.me).then((s) {
      if (mounted) setState(() => _summary = s);
    }).catchError((_) {}); // offline: the card simply stays hidden
  }

  @override
  Widget build(BuildContext context) {
    final s = _summary;
    if (s == null) return const SizedBox.shrink();
    return Card(
      key: const Key('coverageCard'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('ความครอบคลุมตัวชี้วัด', style: Theme.of(context).textTheme.titleMedium),
          Text(
            s.empty == 0 ? 'มีหลักฐานครบทั้ง ${s.total} ตัวชี้วัดแล้ว' : 'ยังไม่มีหลักฐานใน ${s.empty} จาก ${s.total} ตัวชี้วัด',
            key: const Key('coverageGaps'),
          ),
          if (s.waiting > 0) Text('รอผู้บริหารรับรอง ${s.waiting} รายการ'),
          if (s.openSuggestions > 0) Text('คำแนะนำรอคุณตรวจ ${s.openSuggestions} รายการ', key: const Key('coverageSuggestions')),
        ]),
      ),
    );
  }
}
