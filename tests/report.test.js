import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFr3Metadata, neutralizeConnectionData, normalizeFirebirdSql } from '../src/services/fr3-parser.js';
import { getFirebirdConfig } from '../src/services/firebird.js';

test('parser .fr3 extrai consultas, script somente como metadado e remove segredos', () => {
  const xml = `<TfrxReport><TfrxIBDatabase Database="10.1.1.66:C:\\Ganso\\Dados\\Ganso.IB" UserName="SYSDBA" Password="RELATORIO"/><TfrxQuery Name="QryPrincipal" SQL="select * from CLIENTE"/><ScriptText>begin DangerousAction; end</ScriptText></TfrxReport>`;
  const metadata = extractFr3Metadata(xml);
  assert.deepEqual(metadata.queries, ['select * from CLIENTE']);
  assert.equal(metadata.hasPascalScript, true);
  assert.equal(metadata.scripts[0].executable, false);
  assert.doesNotMatch(metadata.sanitizedXml, /10\.1\.1\.66|SYSDBA|RELATORIO|Ganso\.IB/);
});

test('normalização preserva execute block Firebird', () => {
  assert.equal(normalizeFirebirdSql('  execute block returns (x integer) as begin x = 1; suspend; end '), 'execute block returns (x integer) as begin x = 1; suspend; end');
});

test('configuração Firebird é desabilitada sem banco e exige credenciais quando ativada', () => {
  assert.equal(getFirebirdConfig({}).enabled, false);
  assert.throws(() => getFirebirdConfig({ FIREBIRD_DATABASE: 'db.fdb' }), /incompleta/);
  const configured = getFirebirdConfig({ FIREBIRD_DATABASE: 'db.fdb', FIREBIRD_USER: 'report', FIREBIRD_PASSWORD: 'secret' });
  assert.equal(configured.enabled, true);
  assert.equal(configured.config.database, 'db.fdb');
});
