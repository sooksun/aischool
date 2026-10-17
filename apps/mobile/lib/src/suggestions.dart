// P3 (ADR-0010): the owner's sent evidence and, per item, the indicators the
// system suggests. Nothing is mapped until the owner taps "ใช่ ผูกตัวชี้วัดนี้";
// the mapping then waits for the director like any other. While the in-country
// model is not running, suggestions come from the word-matching floor and the
// screen says so.
import 'package:flutter/material.dart';
import 'package:seip_api/seip_api.dart';

import 'outbox.dart' show newClientUuid;

const bandTh = {SuggestionBand.clear: 'ชัดเจน', SuggestionBand.likely: 'น่าจะใช่', SuggestionBand.possible: 'อาจเกี่ยวข้อง'};
const reasonTh = {
  SuggestionRejectReason.notRelevant: 'ไม่เกี่ยวข้อง',
  SuggestionRejectReason.wrongIndicator: 'ผิดตัวชี้วัด',
  SuggestionRejectReason.weakEvidence: 'หลักฐานยังไม่พอ',
  SuggestionRejectReason.wrongPeriod: 'ไม่ใช่ช่วงเวลานี้',
  SuggestionRejectReason.duplicate: 'ซ้ำกับที่ผูกแล้ว',
  SuggestionRejectReason.other: 'อื่น ๆ',
};

/// The owner's items, newest first; tap one for its suggestions.
class MyEvidenceScreen extends StatefulWidget {
  const MyEvidenceScreen({super.key, required this.api, required this.personId});
  final SeipApi api;
  final String personId;

  @override
  State<MyEvidenceScreen> createState() => _MyEvidenceScreenState();
}

class _MyEvidenceScreenState extends State<MyEvidenceScreen> {
  late Future<EvidencePage> _page = _load();

  Future<EvidencePage> _load() => widget.api.evidence.listEvidence(ownerPersonId: widget.personId, pageSize: 50);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('หลักฐานที่ส่งแล้ว')),
      body: RefreshIndicator(
        onRefresh: () async {
          setState(() => _page = _load());
          await _page;
        },
        child: FutureBuilder<EvidencePage>(
          future: _page,
          builder: (context, snap) {
            if (snap.hasError) {
              return ListView(children: const [Padding(padding: EdgeInsets.all(16), child: Text('โหลดไม่ได้ — ยังไม่ได้เชื่อมต่อ'))]);
            }
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final items = snap.data!.items;
            if (items.isEmpty) return ListView(children: const [Padding(padding: EdgeInsets.all(16), child: Text('ยังไม่มีหลักฐานที่ส่งแล้ว'))]);
            return ListView(
              children: [
                for (final e in items)
                  ListTile(
                    key: Key('evidence-${e.id}'),
                    title: Text(e.title),
                    subtitle: e.injectionSuspected == true ? const Text('⚠ รอผู้ดูแลตรวจ') : null,
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => SuggestionsScreen(api: widget.api, evidence: e)),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Open suggestions for one item: accept, or reject with a reason.
class SuggestionsScreen extends StatefulWidget {
  const SuggestionsScreen({super.key, required this.api, required this.evidence});
  final SeipApi api;
  final Evidence evidence;

  @override
  State<SuggestionsScreen> createState() => _SuggestionsScreenState();
}

class _SuggestionsScreenState extends State<SuggestionsScreen> {
  SuggestionPage? _page;
  String? _error;
  String? _busy;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final page = await widget.api.analysis.listEvidenceSuggestions(evidenceId: widget.evidence.id, status: SuggestionStatus.open);
      if (mounted) setState(() => _page = page);
    } catch (_) {
      if (mounted) setState(() => _error = 'โหลดคำแนะนำไม่ได้ — ยังไม่ได้เชื่อมต่อ');
    }
  }

  Future<void> _act(Suggestion s, Future<void> Function() call, String done) async {
    setState(() {
      _busy = s.id;
      _error = null;
    });
    try {
      await call();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(done)));
      await _load();
    } catch (_) {
      if (mounted) setState(() => _error = 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _accept(Suggestion s) => _act(
        s,
        () => widget.api.analysis.acceptSuggestion(suggestionId: s.id, idempotencyKey: newClientUuid()),
        'ผูก ${s.indicatorCode} แล้ว — รอผู้บริหารรับรอง',
      );

  Future<void> _reject(Suggestion s) async {
    final reason = await showDialog<SuggestionRejectReason>(
      context: context,
      builder: (_) => SimpleDialog(
        title: const Text('ไม่ใช่เพราะ'),
        children: [
          for (final r in reasonTh.entries)
            SimpleDialogOption(key: Key('reason-${r.key.name}'), onPressed: () => Navigator.pop(context, r.key), child: Text(r.value)),
        ],
      ),
    );
    if (reason == null) return;
    await _act(
      s,
      () => widget.api.analysis.rejectSuggestion(
        suggestionId: s.id,
        idempotencyKey: newClientUuid(),
        body: SuggestionReject(reasonCode: reason),
      ),
      'บันทึกเหตุผลแล้ว',
    );
  }

  @override
  Widget build(BuildContext context) {
    final page = _page;
    return Scaffold(
      appBar: AppBar(title: Text(widget.evidence.title)),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (widget.evidence.injectionSuspected == true)
              const Card(child: Padding(padding: EdgeInsets.all(12), child: Text('⚠ อาจมีคำสั่งแฝงถึงระบบ AI — ผู้ดูแลระบบโรงเรียนต้องตรวจก่อน'))),
            if (page?.analysis?.provisional == true)
              const Padding(
                key: Key('provisionalNote'),
                padding: EdgeInsets.only(bottom: 8),
                child: Text('คำแนะนำมาจากระบบสำรองแบบจับคำ (ยังไม่ใช่ AI ในประเทศ) — โปรดตรวจเองทุกข้อ'),
              ),
            if (page == null && _error == null) const Center(child: CircularProgressIndicator()),
            if (page != null && page.items.isEmpty) const Text('ยังไม่มีคำแนะนำ', key: Key('noSuggestions')),
            for (final s in page?.items ?? const <Suggestion>[])
              Card(
                key: Key('suggestion-${s.id}'),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${s.indicatorCode} · ${bandTh[s.band] ?? ''}', style: Theme.of(context).textTheme.titleMedium),
                      // Plain text only — model output is never rendered as markup (FR-028).
                      if (s.rationaleTh != null) Text(s.rationaleTh!),
                      for (final l in s.locators)
                        if (l.quote != null) Text('${l.page != null ? 'หน้า ${l.page}: ' : ''}“${l.quote}”', style: const TextStyle(fontStyle: FontStyle.italic)),
                      const SizedBox(height: 8),
                      Wrap(spacing: 8, children: [
                        FilledButton(
                          key: Key('accept-${s.id}'),
                          onPressed: _busy == s.id ? null : () => _accept(s),
                          child: const Text('ใช่ ผูกตัวชี้วัดนี้'),
                        ),
                        OutlinedButton(
                          key: Key('reject-${s.id}'),
                          onPressed: _busy == s.id ? null : () => _reject(s),
                          child: const Text('ไม่ใช่'),
                        ),
                      ]),
                    ],
                  ),
                ),
              ),
            if (_error != null) Text(_error!, key: const Key('suggestionError'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
        ),
      ),
    );
  }
}
