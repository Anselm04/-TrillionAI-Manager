import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:trillionai_manager/api.dart';
void main() {
  test('owner session authorizes backend requests and local logout removes access', () async {
    final api = ManagerApi(baseUrl: 'https://manager.example', authUrl: 'https://auth.example', publishableKey: 'publishable', client: MockClient((request) async {
      if (request.url.path == '/auth/v1/token') { return http.Response('{"access_token":"access","refresh_token":"refresh","expires_in":3600}', 200); }
      if (request.url.path == '/auth/v1/logout') { return http.Response('{}', 200); }
      expect(request.headers['authorization'], 'Bearer access');
      return http.Response('{"running":false}', 200);
    }));
    await api.signIn('owner@example.net', 'password');
    expect((await api.request('/v1/state'))['running'], false);
    await api.signOut();
    await expectLater(api.request('/v1/state'), throwsException);
    api.close();
  });
}
