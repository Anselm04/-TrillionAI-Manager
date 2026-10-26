import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
const api = String.fromEnvironment('MANAGER_API_URL');
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(url: const String.fromEnvironment('SUPABASE_URL'), anonKey: const String.fromEnvironment('SUPABASE_PUBLISHABLE_KEY'));
  runApp(MaterialApp(theme: ThemeData.dark(useMaterial3: true), home: const Manager()));
}
class Manager extends StatefulWidget {
  const Manager({super.key});
  @override
  State<Manager> createState() => _ManagerState();
}
class _ManagerState extends State<Manager> {
  final email = TextEditingController();
  final password = TextEditingController();
  Map<String, dynamic>? state;
  String? error;
  bool busy = false;
  Future<dynamic> request(String path, [Map<String, dynamic>? body]) async {
    final token = Supabase.instance.client.auth.currentSession?.accessToken;
    if (token == null) throw Exception('Sign in required');
    final headers = {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'};
    final uri = Uri.parse('$api$path');
    final response = await (body == null ? http.get(uri, headers: headers) : http.post(uri, headers: headers, body: jsonEncode(body))).timeout(const Duration(seconds: 20));
    if (response.statusCode >= 300) throw Exception('Request failed (${response.statusCode})');
    return jsonDecode(response.body);
  }
  Future<void> act(Future<void> Function() action) async {
    setState(() { busy = true; error = null; });
    try { await action(); } catch (_) { if (mounted) setState(() => error = 'Operation failed. Check authentication, connection and service status.'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> refresh() async { final next = await request('/state'); if (mounted) setState(() => state = next); }
  @override
  void dispose() { email.dispose(); password.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) {
    final signedIn = Supabase.instance.client.auth.currentSession != null;
    return Scaffold(appBar: AppBar(title: const Text('TrillionAI Manager'), actions: [if (signedIn) IconButton(onPressed: busy ? null : () => act(refresh), icon: const Icon(Icons.refresh))]), body: Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 1000), child: ListView(padding: const EdgeInsets.all(24), children: [
      const Text('Sustainable revenue. Real customers. Verified delivery.', style: TextStyle(fontSize: 24)),
      if (error != null) Text(error!, style: const TextStyle(color: Colors.orange)),
      if (busy) const LinearProgressIndicator(),
      if (!signedIn) ...[
        TextField(controller: email, decoration: const InputDecoration(labelText: 'Owner email'), keyboardType: TextInputType.emailAddress),
        TextField(controller: password, obscureText: true, decoration: const InputDecoration(labelText: 'Password')),
        FilledButton(onPressed: busy ? null : () => act(() async { await Supabase.instance.client.auth.signInWithPassword(email: email.text.trim(), password: password.text); await refresh(); }), child: const Text('Sign in')),
      ] else ...[
        FilledButton(onPressed: busy ? null : () => act(() async { await request('/mission', {'running': state?['running'] != true}); await refresh(); }), child: Text(state?['running'] == true ? 'Pause TrillionAI' : 'Run TrillionAI')),
        const Text('Pause stops new work; jobs already sent to ecosystem services may finish.'),
        if (state == null) const Text('Refresh to load verified business state.'),
        if (state != null) ...[
          Text('First paying customer: ${state!['metrics']['firstPayingCustomer']}'),
          Text('First customer delivered: ${state!['metrics']['firstCustomerDelivered']}'),
          Text('Connected adapters: ${(state!['integrations'] as List).join(', ')}'),
          const SizedBox(height: 16), const Text('Revenue and health', style: TextStyle(fontSize: 20)),
          SelectableText(const JsonEncoder.withIndent('  ').convert(state!['metrics'])),
          const SizedBox(height: 16), const Text('Operations and approvals', style: TextStyle(fontSize: 20)),
          for (final task in state!['tasks']) Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${task['action']} • ${task['status']} • attempt ${task['attempts']}'),
            SelectableText(jsonEncode(task['payload'])),
            if (task['error'] != null) Text(task['error']),
            if (task['status'] == 'approval') Wrap(children: [for (final decision in ['approve', 'reject']) TextButton(onPressed: busy ? null : () => act(() async { await request('/approvals', {'taskId': task['id'], 'decision': decision}); await refresh(); }), child: Text(decision))]),
          ]))),
          const Text('Audit trail', style: TextStyle(fontSize: 20)),
          for (final entry in state!['audit']) Text('${entry['event']} ${jsonEncode(entry['details'])}'),
        ],
        TextButton(onPressed: busy ? null : () => act(() async { await Supabase.instance.client.auth.signOut(); if (mounted) setState(() => state = null); }), child: const Text('Sign out')),
      ],
    ]))));
  }
}
