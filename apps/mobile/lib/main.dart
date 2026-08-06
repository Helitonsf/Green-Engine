import 'package:flutter/material.dart';

void main() => runApp(const GreenEngineApp());

class GreenEngineApp extends StatelessWidget {
  const GreenEngineApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Green Engine',
    theme: ThemeData(colorSchemeSeed: const Color(0xff18a558), useMaterial3: true),
    home: const DashboardPage(),
  );
}

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Green Engine')),
    body: ListView(padding: const EdgeInsets.all(16), children: const [
      Card(child: ListTile(title: Text('Projeto Green 15K'), subtitle: Text('Nenhum ciclo ativo'), leading: Icon(Icons.trending_up))),
      Card(child: ListTile(title: Text('Partidas analisadas'), subtitle: Text('Aguardando integração com a API'), leading: Icon(Icons.sports_soccer))),
    ]),
  );
}
