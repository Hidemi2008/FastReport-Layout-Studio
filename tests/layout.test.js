import test from 'node:test';
import assert from 'node:assert/strict';
import { dbComSeed } from './helpers.js';
import { aplicarLayout, extrairVariaveis, salvarLayout, resolverLayout, validarFr3 } from '../src/services/layout.js';
import { obterDavCompleto } from '../src/services/dav.js';
import { getConfig } from '../src/services/config.js';
import { parseFr3File, extractFr3Metadata, neutralizeConnectionData, parseFr3FileSafe } from '../src/services/fr3-parser.js';
import { fileURLToPath } from 'node:url';

const fr3 = '<?xml version="1.0"?><TfrxReport><MemoView>[Cliente.Nome] [Documento.Numero] [Item.Descricao]</MemoView></TfrxReport>';

test('layouts: valida XML, extrai variáveis e resolve por cliente', () => {
  const { db, orcId } = dbComSeed();
  assert.deepEqual(extrairVariaveis(fr3), ['Cliente.Nome', 'Documento.Numero', 'Item.Descricao']);
  assert.throws(() => validarFr3('<TfrxReport>'), /incompleto|corrompido/);
  assert.throws(() => validarFr3('<TfrxReport><MemoView></TfrxReport>'), /desencontradas/);
  const geral = salvarLayout(db, { nome: 'Orçamento padrão.fr3', tipo_documento: 'O', conteudo_fr3: fr3, padrao: true }, { usuario: 'gerente' });
  const cliente = salvarLayout(db, { nome: 'Cliente especial.fr3', tipo_documento: 'O', cliente_id: 1, conteudo_fr3: fr3, padrao: true }, { usuario: 'gerente' });
  assert.equal(resolverLayout(db, { tipo: 'O', clienteId: 1 }).id, cliente.id);
  assert.equal(resolverLayout(db, { tipo: 'O', clienteId: 2 }).id, geral.id);
  const xml = aplicarLayout(cliente, obterDavCompleto(db, orcId, getConfig(db)));
  assert.match(xml, /Fazenda Boa Vista/);
  assert.doesNotMatch(xml, /\[Cliente\.Nome\]/);
});

test('layout.fr3 real do projeto é importável e expõe propriedades essenciais', () => {
  const metadata = parseFr3File(fileURLToPath(new URL('../layout.fr3', import.meta.url)));
  assert.equal(metadata.reportTitle, 'Studio Layout');
  assert.ok(metadata.components.includes('TfrxReport'));
  assert.deepEqual(metadata.warnings, []);
});

for (const fileName of ['PADRÃO vendas.fr3', 'EtiquetaKit4 V2.fr3']) {
  test(`layout Ganso real ${fileName} é importado sem exceção`, () => {
    const result = parseFr3FileSafe(fileURLToPath(new URL(`../${fileName}`, import.meta.url)));
    assert.equal(result.ok, true);
    assert.ok(result.components.length > 0);
    assert.ok(result.elements.length > 0);
    assert.ok(result.elements.every((element) => Number.isFinite(element.x) && Number.isFinite(element.y)));
    assert.ok(new Set(result.elements.map((element) => element.x)).size > 3);
    assert.ok(new Set(result.elements.map((element) => element.y)).size > 3);
    assert.ok(result.elements.some((element) => element.x > 0 && element.y > 0));
    assert.ok(Math.max(...result.elements.map((element) => element.x + element.largura)) > 100);
    assert.ok(result.elements.some((element) => element.tipo === 'texto' || element.tipo === 'itens' || element.tipo === 'rodape'));
    assert.ok(result.layout.elementos.length === result.elements.length);
    assert.ok(result.layout.nome);
    assert.ok(Array.isArray(result.datasetNames));
    assert.ok(Array.isArray(result.queries));
    assert.doesNotMatch(result.sanitizedXml, /10\.1\.1\.66|C:\\Ganso\\Dados\\Ganso\.IB|UserName="SYSDBA"|Password="RELATORIO"/i);
  });
}

test('parser tolerante processa PropData, PascalScript e SQL legado sem executar script', () => {
  const legacy = Buffer.from(`<TfrxReport><ReportPage Name="Page1"/><TfrxDBDataset Name="QryPrincipal" PropData="\\u0000\\u00FF"><SQL>execute block returns (x integer) as begin x = 1; suspend; end</SQL><ScriptText>begin DeleteEverything; end</ScriptText><Connection Database="10.1.1.66:C:\\Ganso\\Dados\\Ganso.IB" UserName="SYSDBA" Password="RELATORIO"/></TfrxReport>`, 'utf8');
  const metadata = extractFr3Metadata(legacy);
  assert.equal(metadata.tolerant, true);
  assert.deepEqual(metadata.queries, ['execute block returns (x integer) as begin x = 1; suspend; end']);
  assert.deepEqual(metadata.components, ['TfrxReport', 'ReportPage', 'TfrxDBDataset']);
  assert.equal(metadata.scripts[0].executable, false);
  assert.doesNotMatch(metadata.sanitizedXml, /10\.1\.1\.66|Ganso\.IB|SYSDBA|RELATORIO/);
});

test('parser tolerante não derruba importação de texto truncado', () => {
  const metadata = extractFr3Metadata(Buffer.from('\u0000TfrxReport Name="Legacy"\u0000 PropData=\u00FF'));
  assert.equal(metadata.tolerant, true);
  assert.ok(metadata.warnings.length > 0);
  assert.equal(metadata.queries.length, 0);
});
