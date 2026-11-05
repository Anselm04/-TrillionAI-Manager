import 'package:flutter/material.dart';

typedef CustomerRequest = Future<dynamic> Function(String path, [Map<String, dynamic>? body]);

class CustomerWorkspace extends StatefulWidget {
  const CustomerWorkspace({super.key, required this.request});
  final CustomerRequest request;
  @override
  State<CustomerWorkspace> createState() => _CustomerWorkspaceState();
}

class _CustomerWorkspaceState extends State<CustomerWorkspace> {
  final business = TextEditingController();
  final offer = TextEditingController();
  final audience = TextEditingController();
  final goal = TextEditingController();
  final channels = TextEditingController();
  final note = TextEditingController();
  final customerChange = TextEditingController(text: '0');
  Map<String, dynamic>? brief;
  Map<String, dynamic>? preference;
  List<dynamic> reports = [];
  bool loading = true;
  bool busy = false;
  bool confirm = false;
  bool understands = false;
  String? error;
  String? message;
  String level = 'none';
  String cadence = 'off';
  String method = 'direction';
  String direction = 'same';
  double rating = 3;

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    for (final controller in [business, offer, audience, goal, channels, note, customerChange]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> load() async {
    try {
      final rows = (await widget.request('/customer/briefs')) as List<dynamic>;
      final growth = (await widget.request('/customer/growth')) as Map<String, dynamic>;
      if (!mounted) return;
      setState(() {
        brief = rows.isEmpty ? null : Map<String, dynamic>.from(rows.last as Map);
        if (brief != null) {
          business.text = (brief!['business'] ?? '').toString();
          offer.text = (brief!['offer'] ?? '').toString();
          audience.text = (brief!['audience'] ?? '').toString();
          goal.text = (brief!['goal'] ?? '').toString();
          channels.text = ((brief!['channels'] as List?) ?? []).join(', ');
        }
        preference = growth['preference'] == null ? null : Map<String, dynamic>.from(growth['preference'] as Map);
        reports = (growth['reports'] as List?) ?? [];
        level = (preference?['level'] ?? 'none').toString();
        cadence = (preference?['cadence'] ?? 'off').toString();
        loading = false;
      });
    } catch (_) {
      if (mounted) setState(() { error = 'Unable to load customer information. Please retry.'; loading = false; });
    }
  }

  Future<void> act(Future<void> Function() task) async {
    setState(() { busy = true; error = null; message = null; });
    try { await task(); }
    catch (_) { if (mounted) setState(() => error = 'Your request could not be completed. Please check the information and try again.'); }
    finally { if (mounted) setState(() => busy = false); }
  }

  Future<void> saveBrief() async {
    final payload = <String, dynamic>{
      'business': business.text.trim(),
      'offer': offer.text.trim(),
      'audience': audience.text.trim(),
      'goal': goal.text.trim(),
      'channels': channels.text.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList(),
    };
    if (brief != null && brief!['status'] != 'confirmed') payload['id'] = brief!['id'];
    final response = await widget.request('/customer/briefs', payload);
    if (!mounted) return;
    setState(() { brief = Map<String, dynamic>.from(response as Map); confirm = false; message = 'Your brief has been saved. Review any follow-up questions below.'; });
  }

  Future<void> confirmBrief() async {
    if (brief == null || !confirm) return;
    final id = Uri.encodeComponent(brief!['id'].toString());
    final result = await widget.request('/customer/briefs/$id/confirm', {
      'confirmed': true,
      'revision': brief!['revision'],
      'acknowledgementVersion': 'customer-brief-v1',
    });
    if (!mounted) return;
    setState(() { brief = Map<String, dynamic>.from(result as Map); message = 'Your requirements are confirmed.'; });
  }

  Future<void> savePreferences() async {
    if (!understands) return;
    final result = await widget.request('/customer/measurement-preferences', {
      'level': level,
      'cadence': level == 'none' ? 'off' : cadence,
      'understoodLimitations': true,
    });
    if (!mounted) return;
    setState(() { preference = Map<String, dynamic>.from(result as Map); understands = false; message = 'Your privacy preference was saved.'; });
  }

  Future<void> saveReport() async {
    final period = DateTime.now().toIso8601String().substring(0, cadence == 'weekly' ? 10 : 7);
    final dynamic value = method == 'direction' ? direction : method == 'scale' ? rating.toInt() : int.parse(customerChange.text.trim());
    await widget.request('/customer/growth', {
      'period': period,
      'method': method,
      'value': value,
      'note': note.text.trim(),
    });
    if (!mounted) return;
    setState(() { message = 'Your optional growth feedback was recorded as self-reported information.'; note.clear(); });
    await load();
  }

  Widget field(TextEditingController controller, String label, String hint, {int lines = 1}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(controller: controller, maxLines: lines, decoration: InputDecoration(labelText: label, hintText: hint, border: const OutlineInputBorder())),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator());
    return ListView(padding: const EdgeInsets.all(20), children: [
      const Text('Your TrillionAI Manager', style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold)),
      const SizedBox(height: 8),
      const Text('Tell us about your business, confirm what matters, and share only the results you feel comfortable providing.'),
      if (error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(error!, style: const TextStyle(color: Colors.orange))),
      if (message != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(message!, style: const TextStyle(color: Colors.greenAccent))),
      if (busy) const LinearProgressIndicator(),
      const SizedBox(height: 20),
      Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Your marketing requirements', style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        const Text('Use your own words. Your Manager will ask for clarification if essential details are missing.'),
        const SizedBox(height: 16),
        field(business, 'What does your business do?', 'Example: I make wooden furniture'),
        field(offer, 'What would you like to promote?', 'Products or services'),
        field(audience, 'Who are your ideal customers?', 'Who and where?'),
        field(goal, 'What would success look like?', 'More bookings, enquiries, paying customers...', lines: 2),
        field(channels, 'Preferred platforms (optional)', 'facebook, instagram'),
        if (brief?['status'] != 'confirmed')
          FilledButton(onPressed: busy ? null : () => act(saveBrief), child: const Text('Save and review my answers')),
        if (brief != null) ...[
          const SizedBox(height: 12),
          Text('Brief status: ${brief!['status']}'),
          for (final question in (brief!['questions'] as List? ?? []))
            Padding(padding: const EdgeInsets.symmetric(vertical: 5), child: Text('• $question')),
          if (brief!['status'] == 'ready_for_confirmation') ...[
            const SizedBox(height: 8),
            CheckboxListTile(
              value: confirm,
              onChanged: (value) => setState(() => confirm = value ?? false),
              title: const Text('I have checked my requirements and understand that accurate information supports better recommendations. Results cannot be guaranteed.'),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            FilledButton(onPressed: busy || !confirm ? null : () => act(confirmBrief), child: const Text('Confirm my requirements')),
          ],
          if (brief!['status'] == 'confirmed') const Text('Confirmed requirements are saved. Please contact support if your needs change.'),
        ],
      ]))),
      const SizedBox(height: 16),
      Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('Your privacy and growth feedback', style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        const Text('Actual revenue is never required. More reliable sales information may improve measurement, but it does not guarantee improved results.'),
        for (final option in const [
          ('none', 'Keep business results private'),
          ('summary', 'Share thumbs or a five-point scale'),
          ('counts', 'Share optional customer-count changes'),
          ('connected', 'Allow selected connected data (integration requires separate setup)'),
        ]) RadioListTile<String>(
          value: option.$1, groupValue: level,
          onChanged: (value) => setState(() { level = value ?? 'none'; cadence = level == 'none' ? 'off' : cadence == 'off' ? 'monthly' : cadence; understands = false; }),
          title: Text(option.$2),
        ),
        if (level != 'none') DropdownButtonFormField<String>(
          value: cadence == 'off' ? 'monthly' : cadence,
          decoration: const InputDecoration(labelText: 'Reporting frequency'),
          items: const [DropdownMenuItem(value: 'weekly', child: Text('Weekly')), DropdownMenuItem(value: 'monthly', child: Text('Monthly'))],
          onChanged: (value) => setState(() { cadence = value ?? 'monthly'; understands = false; }),
        ),
        CheckboxListTile(
          value: understands,
          onChanged: (value) => setState(() => understands = value ?? false),
          title: const Text('I understand that limited information restricts revenue-based measurement and choose this level voluntarily.'),
          controlAffinity: ListTileControlAffinity.leading,
        ),
        FilledButton(onPressed: busy || !understands ? null : () => act(savePreferences), child: const Text('Save privacy preference')),
      ]))),
      if (preference != null && preference!['level'] != 'none' && preference!['cadence'] != 'off') ...[
        const SizedBox(height: 16),
        Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('A quick business check-in', style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold)),
          const Text('Compared with your usual period, have paying customers increased, decreased or stayed the same?'),
          DropdownButtonFormField<String>(
            value: method,
            decoration: const InputDecoration(labelText: 'Feedback method'),
            items: [
              const DropdownMenuItem(value: 'direction', child: Text('More / same / fewer')),
              const DropdownMenuItem(value: 'scale', child: Text('Five-point scale')),
              if (preference!['level'] != 'summary') const DropdownMenuItem(value: 'count', child: Text('Numerical customer change')),
            ],
            onChanged: (value) => setState(() => method = value ?? 'direction'),
          ),
          if (method == 'direction') DropdownButtonFormField<String>(
            value: direction,
            items: const [
              DropdownMenuItem(value: 'up', child: Text('More paying customers')),
              DropdownMenuItem(value: 'same', child: Text('About the same')),
              DropdownMenuItem(value: 'down', child: Text('Fewer paying customers')),
            ],
            onChanged: (value) => setState(() => direction = value ?? 'same'),
          ),
          if (method == 'scale') Slider(value: rating, min: 1, max: 5, divisions: 4, label: rating.round().toString(), onChanged: (value) => setState(() => rating = value)),
          if (method == 'count') field(customerChange, 'Customer-number change (+/-)', 'Example: 5 or -3'),
          field(note, 'Anything else we should know? (optional)', 'Seasonal events, holidays, promotions', lines: 2),
          FilledButton(onPressed: busy ? null : () => act(saveReport), child: const Text('Submit optional check-in')),
          const SizedBox(height: 8),
          Text('Past check-ins: ${reports.length} · All self-reported, not verified revenue.'),
        ]))),
      ],
    ]);
  }
}
