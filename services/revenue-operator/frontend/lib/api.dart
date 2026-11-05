import 'dart:convert';
import 'package:http/http.dart' as http;

class ManagerApi {
  ManagerApi({required this.baseUrl, required this.authUrl, required this.publishableKey, http.Client? client}) : _client = client ?? http.Client();
  final String baseUrl, authUrl, publishableKey;
  final http.Client _client;
  String? _access, _refresh;
  DateTime _expires = DateTime.fromMillisecondsSinceEpoch(0);
  Future<void> signIn(String email, String password) async {
    await _authenticate('password', {'email': email, 'password': password});
  }
  Future<void> _authenticate(String grant, Map<String, dynamic> data) async {
    final response = await _client.post(Uri.parse('$authUrl/auth/v1/token?grant_type=$grant'), headers: {'apikey': publishableKey, 'content-type': 'application/json'}, body: jsonEncode(data)).timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) { throw Exception('Sign-in failed. Check your account or sign in again.'); }
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    _access = body['access_token'] as String;
    _refresh = body['refresh_token'] as String;
    _expires = DateTime.now().add(Duration(seconds: (body['expires_in'] as num).toInt() - 60));
  }
  Future<dynamic> request(String path, [Map<String, dynamic>? body]) async {
    if (_access == null) { throw Exception('Sign in first.'); }
    if (DateTime.now().isAfter(_expires)) { await _authenticate('refresh_token', {'refresh_token': _refresh}); }
    final headers = {'authorization': 'Bearer $_access', 'content-type': 'application/json'};
    final uri = Uri.parse('$baseUrl$path');
    final response = await (body == null ? _client.get(uri, headers: headers) : _client.post(uri, headers: headers, body: jsonEncode(body))).timeout(const Duration(seconds: 25));
    if (response.statusCode < 200 || response.statusCode >= 300) { throw Exception(response.statusCode == 403 ? 'Owner access is required.' : 'Request failed (${response.statusCode}).'); }
    return jsonDecode(response.body);
  }
  Future<void> signOut() async {
    final token = _access; _access = null; _refresh = null;
    if (token != null) {
      try { await _client.post(Uri.parse('$authUrl/auth/v1/logout'), headers: {'apikey': publishableKey, 'authorization': 'Bearer $token'}).timeout(const Duration(seconds: 10)); } catch (_) { /* Local session is already cleared. */ }
    }
  }
  void close() { _access = null; _refresh = null; _client.close(); }
}
