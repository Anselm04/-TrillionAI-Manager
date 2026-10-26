import 'dart:async';
import 'package:flutter/material.dart';
import 'api.dart';
void main() => runApp(const ManagerApp());

class ManagerApp extends StatelessWidget {
  const ManagerApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(title: 'TrillionAI Manager', debugShowCheckedModeBanner: false, theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff65d6b4), brightness: Brightness.dark), useMaterial3: true), home: const ControlRoom());
}
class ControlRoom extends StatefulWidget {
  const ControlRoom({super.key});
  @override
  State<ControlRoom> createState() => _ControlRoomState();
}
class _ControlRoomState extends State<ControlRoom> {
  final api = ManagerApi(baseUrl: const String.fromEnvironment('MANAGER_URL'), authUrl: const String.fromEnvironment('SUPABASE_URL'), publishableKey: const String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY'));
  final email = TextEditingController(), password = TextEditingController();
  Map<String, dynamic>? state;
  String? error;
  bool busy = false;
  Timer? timer;
  @override
  void initState() { super.initState(); timer = Timer.periodic(const Duration(seconds: 20), (_) { if (state != null && !busy) { refresh(); } }); }
  @override
  void dispose() { timer?.cancel(); email.dispose(); password.dispose(); api.close(); super.dispose(); }
  Future<void> perform(Future<void> Function() action) async {
    if (busy) { return; }
    setState(() { busy = true; error = null; });
    try { await action(); } catch (e) { if (mounted) { setState(() => error = e.toString()); } }
    finally { if (mounted) { setState(() => busy = false); } }
  }
  Future<void> refresh() async {
    try { final next = await api.request('/v1/state') as Map<String, dynamic>; if (mounted) { setState(() { state = next; error = null; }); } }
    catch (e) { if (mounted) { setState(() => error = e.toString()); } }
  }
  Future<void> command(String path, Map<String, dynamic> body) => perform(() async { await api.request(path, body); await refresh(); });
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('TrillionAI Manager'), actions: [if (state != null) IconButton(tooltip: 'Sign out', onPressed: () => perform(() async { await api.signOut(); if (mounted) { setState(() => state = null); } }), icon: const Icon(Icons.logout))]), body: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 1100), child: ListView(padding: const EdgeInsets.all(24), children: [
    const Text('Build a profitable company.', style: TextStyle(fontSize: 30, fontWeight: FontWeight.bold)),
    const SizedBox(height: 8), const Text('Real customers. Verified delivery. Sustainable revenue.'),
    if (busy) const LinearProgressIndicator(),
    if (error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error))),
    const SizedBox(height: 24),
    if (state == null) ...[
      TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Owner email')),
      TextField(controller: password, obscureText: true, onSubmitted: (_) => login(), decoration: const InputDecoration(labelText: 'Password')),
      const SizedBox(height: 16), FilledButton(onPressed: busy ? null : login, child: const Text('Sign in')),
    ] else ...dashboard(),
  ]))));
  void login() { perform(() async { await api.signIn(email.text.trim(), password.text); password.clear(); await refresh(); }); }
  List<Widget> dashboard() {
    final s = state!, running = (s['mission'] as Map?)?['running'] == true;
    final metrics = s['metrics'] as Map<String, dynamic>;
    final currencies = (metrics['currencies'] as List).cast<Map<String, dynamic>>();
    return [
      Card(child: Padding(padding: const EdgeInsets.all(20), child: Wrap(spacing: 16, runSpacing: 12, crossAxisAlignment: WrapCrossAlignment.center, children: [Chip(label: Text(running ? 'Mission running' : 'Mission paused')), FilledButton.icon(onPressed: busy ? null : () => command('/v1/mission', {'running': !running}), icon: Icon(running ? Icons.pause : Icons.play_arrow), label: Text(running ? 'Pause operations' : 'Run TrillionAI')), OutlinedButton(onPressed: busy ? null : refresh, child: const Text('Refresh'))]))),
      for (final c in currencies) Card(child: Padding(padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text((c['currency'] as String).toUpperCase(), style: const TextStyle(fontSize: 20)), Text('Customers: ${c['customers']}  •  MRR: ${money(c['mrr'])}  •  ARR: ${money(c['arr'])}'), Text('Net collected: ${money(c['net_collected'])}  •  Recorded costs: ${money(c['operating_cost'])}'), Text(c['first_paying_customer_at'] == null ? 'First paying customer: not achieved' : 'First paying customer recorded: ${c['first_paying_customer_at']}')]))),
      if (currencies.isEmpty) const Card(child: Padding(padding: EdgeInsets.all(20), child: Text('No verified revenue recorded. First paying customer not achieved.'))),
      Text('Leads: ${metrics['leads']}  •  Open support: ${metrics['open_support']}  •  Failed tasks: ${metrics['failed_tasks']}'),
      const SizedBox(height: 24), const Text('Owner approvals', style: TextStyle(fontSize: 22)),
      for (final a in s['approvals'] as List) Card(child: ListTile(title: Text('${a['kind']} · ${a['system']}'), subtitle: Text('Spending cap: ${a['amount']} minor units · expires ${a['expires_at']}\n${a['payload']}'), trailing: Wrap(children: [TextButton(onPressed: busy ? null : () => command('/v1/approvals/${a['id']}', {'approved': false}), child: const Text('Reject')), FilledButton(onPressed: busy ? null : () => command('/v1/approvals/${a['id']}', {'approved': true}), child: const Text('Approve'))]))),
      const SizedBox(height: 24), const Text('Offers', style: TextStyle(fontSize: 22)),
      for (final o in s['offers'] as List) ListTile(leading: Icon(o['ready'] == true ? Icons.check_circle : Icons.pending), title: Text('${o['name']} · ${o['currency']} ${money(o['unit_amount'])}'), subtitle: Text(o['ready'] == true ? 'Evidence checked: ${o['verified_at']}' : 'Blocked: checkout and delivery evidence required')),
      const SizedBox(height: 24), const Text('Operations and recovery', style: TextStyle(fontSize: 22)),
      for (final t in s['tasks'] as List) Card(child: ListTile(title: Text('${t['kind']} · ${t['system']} · ${t['status']}'), subtitle: Text('${t['last_error'] ?? 'No recorded error'} · attempt ${t['attempts']}'), trailing: t['status'] == 'dead' ? TextButton(onPressed: busy ? null : () => command('/v1/tasks/${t['id']}/retry', {}), child: const Text('Retry')) : null)),
      const SizedBox(height: 20), Text('Configured adapters: ${(s['integrations'] as List).join(', ')}'),
      const Text('Configured does not mean qualified or live. Revenue and product evidence must pass before selling.'),
    ];
  }
  String money(dynamic value) => ((value as num? ?? 0) / 100).toStringAsFixed(2);
}
