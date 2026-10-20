import test from 'node:test';
import assert from 'node:assert/strict';
import { dbComSeed } from './helpers.js';
import { createApp } from '../src/app.js';

async function servidor() {
  const { db, orcId } = dbComSeed();
  const srv = createApp(db).listen(0); await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  return { base, orcId, close: () => srv.close() };
}
const j = (r) => r.json();

test('API: config, preview sem gravar, impressão/reimpressão e auditoria', async () => {
  const { base, orcId, close } = await servidor();
  try {
    const { config } = await fetch(`${base}/config`).then(j);
    const rascunho = { geral: { formato: 'BOBINA80', modoImpressao: 'TERMICO' } };
    const prev = await fetch(`${base}/davs/${orcId}/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rascunho) }).then((r) => r.text());
    assert.match(prev, /<pre>/);
    assert.equal((await fetch(`${base}/config`).then(j)).config.geral.formato, config.geral.formato, 'preview não grava');

    await fetch(`${base}/davs/${orcId}/render?imprimir=1`, { headers: { 'x-usuario': 'ana' } });
    const seg = await fetch(`${base}/davs/${orcId}/render?imprimir=1`, { headers: { 'x-usuario': 'ana' } }).then((r) => r.text());
    assert.match(seg, /REIMPRESSÃO/);
    const log = await fetch(`${base}/davs/${orcId}/auditoria`).then(j);
    assert.deepEqual(log.map((l) => l.acao).slice(0, 2), ['REIMPRIMIU', 'IMPRIMIU']);
  } finally { close(); }
});

test('API: reimpressão bloqueada por config exige autorização', async () => {
  const { base, orcId, close } = await servidor();
  try {
    const { config } = await fetch(`${base}/config`).then(j);
    config.geral.bloquearReimpressao = true;
    assert.equal((await fetch(`${base}/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config) })).status, 200);
    await fetch(`${base}/davs/${orcId}/render?imprimir=1`);
    assert.equal((await fetch(`${base}/davs/${orcId}/render?imprimir=1`)).status, 403);
    assert.equal((await fetch(`${base}/davs/${orcId}/render?imprimir=1`, { headers: { 'x-permite-reimpressao': 'sim' } })).status, 200);
  } finally { close(); }
});

test('API: sync offline, observação por item, whatsapp e config inválida', async () => {
  const { base, orcId, close } = await servidor();
  try {
    const body = { davs: [{ client_uuid: 'u1', tipo: 'O', itens: [{ produto_id: 2, quantidade: 2 }] }, { client_uuid: 'u2', tipo: 'X', itens: [] }] };
    const s = await fetch(`${base}/sync`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j);
    assert.ok(s.resultado[0].id); assert.ok(s.resultado[1].erro);
    const full = await fetch(`${base}/davs/${orcId}`).then(j);
    const ok = await fetch(`${base}/davs/${orcId}/itens/${full.itens[0].id}/observacao`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ observacao: 'ok' }) });
    assert.equal(ok.status, 200);
    const wa = await fetch(`${base}/davs/${orcId}/exportar/whatsapp`).then(j);
    assert.match(wa.url, /^https:\/\/wa\.me\/5567/);
    const ruim = await fetch(`${base}/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ geral: { vias: 0 } }) });
    assert.equal(ruim.status, 422);
  } finally { close(); }
});

test('API: Studio mono-usuário permite editar layouts sem perfil', async () => {
  const { base, close } = await servidor();
  try {
    const body = { nome: 'Teste.fr3', tipo_documento: 'O', conteudo_fr3: '<TfrxReport></TfrxReport>' };
    const r = await fetch(`${base}/layouts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(r.status, 201);
    assert.equal((await fetch(`${base}/layouts/${(await r.json()).id}`)).status, 200);
  } finally { close(); }
});

test('API: Studio cria, valida, abre e salva arquivo fr3', async () => {
  const { base, close } = await servidor();
  const caminho = `C:\\Users\\manfr\\Downloads\\dav-module\\dav-module\\tests\\tmp-studio-${Date.now()}.fr3`;
  try {
    const novo = await fetch(`${base}/studio/novo`).then(j);
    assert.match(novo.conteudo_fr3, /TfrxReport/);
    const salvo = await fetch(`${base}/studio/salvar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caminho_arquivo: caminho, conteudo_fr3: novo.conteudo_fr3 }) }).then(j);
    assert.equal(salvo.caminho_arquivo, caminho);
    const aberto = await fetch(`${base}/studio/abrir`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caminho_arquivo: caminho }) }).then(j);
    assert.equal(aberto.conteudo_fr3, novo.conteudo_fr3);
  } finally {
    try { (await import('node:fs')).unlinkSync(caminho); } catch {}
    close();
  }
});

test('API: Studio visual persiste layout e gera preview com dataset', async () => {
  const { base, close } = await servidor();
  try {
    const atual = await fetch(`${base}/layout`).then(j);
    assert.ok(Array.isArray(atual.elementos));
    atual.nome = 'Layout visual teste';
    atual.elementos.push({ id: 'texto-teste', tipo: 'texto', titulo: 'Observação', texto: 'Cliente: [Cliente.Nome]', x: 40, y: 720, largura: 300, altura: 40, estilo: { fontFamily: 'Arial', fontSize: 14, fontWeight: '400', textAlign: 'left', color: '#14213d', background: 'transparent', borderColor: '#cfd6e0', borderWidth: 0, padding: 6 } });
    assert.equal((await fetch(`${base}/layout`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(atual) })).status, 200);
    const salvo = await fetch(`${base}/layout`).then(j);
    assert.equal(salvo.nome, 'Layout visual teste');
    const preview = await fetch(`${base}/layout/preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: salvo }) }).then((r) => r.text());
    assert.match(preview, /Produto de teste/);
    assert.match(preview, /Cliente de demonstração/);
  } finally { close(); }
});
