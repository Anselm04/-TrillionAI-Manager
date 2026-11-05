import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:trillionai_manager/main.dart';
void main() {
  testWidgets('owner sees authentication before business controls', (tester) async {
    await tester.pumpWidget(const ManagerApp());
    expect(find.text('Sign in'), findsOneWidget);
    expect(find.text('Run TrillionAI'), findsNothing);
    await tester.pumpWidget(const SizedBox.shrink());
  });
}
