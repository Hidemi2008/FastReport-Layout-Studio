import test from 'node:test';
import assert from 'node:assert/strict';
import { dbComSeed } from './helpers.js';
import { formatMask } from '../src/services/format.js';
import { getConfig, saveConfig, restaurarPadroes, validarConfig, DEFAULTS } from '../src/services/config.js';
import { qryPrincipal, qryItens, qryNegociacao, criarDav, atualizarObservacaoItem, obterDavCompleto } from '../src/services/dav.js';
import { renderGraficoDocumento, renderTermico, descricaoTermica } from '../src/services/render.js';
import { expirarVencidos, recalcularPrecos } from '../src/services/validity.js';
import { listAudit } from '../src/services/audit.js';

test('máscaras numéricas pt-BR', () => {
  assert.equal(formatMask(1234.5, ',0.00'), '1.234,50');
  assert.equal(formatMask(1234.5, 'R$ #,0.00').replace(/\u00a0/g, ' '), 'R$ 1.234,50');
  assert.equal(formatMask(7, '0'), '7');
});

test('kit: componentes não duplicam o bruto', () => {
  const { db, orcId } = dbComSeed();
  const d = qryPrincipal(db, orcId);
  assert.equal(d.total_bruto, 3549.3);
  assert.equal(d.total_liquido, 3579.3);
});

for (const rateio of ['UNIDADE', 'ITEM', 'FECHAMENTO']) {
  test(`rateio ${rateio}: soma das linhas + frete = líquido`, () => {
    const { db, orcId } = dbComSeed();
    const cfg = getConfig(db); cfg.geral.rateio = rateio;
    const doc = qryPrincipal(db, orcId, cfg);
    const soma = qryItens(db, orcId, cfg, doc).reduce((s, i) => s + i.valor_total, 0);
    const esperado = rateio === 'FECHAMENTO' ? doc.total_bruto : doc.total_bruto - doc.desconto_fechamento;
    assert.ok(Math.abs(soma - esperado) < 0.01, `${soma} != ${esperado}`);
  });
}

test('desconto por item em modo UNIDADE multiplica pela quantidade', () => {
  const { db } = dbComSeed();
  const id = criarDav(db, { tipo: 'O', itens: [{ produto_id: 2, quantidade: 10, desconto: 1 }] }).id;
  const cfg = getConfig(db); cfg.geral.descontoAcrescimoModo = 'ITEM'; cfg.geral.rateio = 'UNIDADE';
  assert.equal(qryPrincipal(db, id, cfg).total_desconto, 10);
  cfg.geral.rateio = 'ITEM';
  assert.equal(qryPrincipal(db, id, cfg).total_desconto, 1);
});

test('modelo AGRUPADO funde linhas idênticas e GRADE mostra descrição reduzida', () => {
  const { db, orcId } = dbComSeed();
  const cfg = getConfig(db);
  cfg.grafico.modeloItens = 'AGRUPADO';
  const itens = qryItens(db, orcId, cfg);
  const camisetas = itens.filter((i) => i.codigo === '1003');
  assert.equal(camisetas.length, 1); assert.equal(camisetas[0].quantidade, 3);
  assert.equal(camisetas[0].descricao, 'Camiseta UV - Azul/G');
  assert.deepEqual(itens.filter((i) => i.tipo_linha === 'COMPONENTE').length, 2);
});

test('ordenação por descrição mantém componentes sob o kit mestre', () => {
  const { db, orcId } = dbComSeed();
  const cfg = getConfig(db); cfg.grafico.ordenacao = 'DESCRICAO';
  const itens = qryItens(db, orcId, cfg);
  const iKit = itens.findIndex((i) => i.tipo_linha === 'KIT');
  assert.equal(itens[iKit + 1].tipo_linha, 'COMPONENTE'); assert.equal(itens[iKit + 2].tipo_linha, 'COMPONENTE');
});

test('negociação: saldo, troco e bloqueio de pedido desbalanceado', () => {
  const { db } = dbComSeed();
  assert.throws(() => criarDav(db, { tipo: 'P', itens: [{ produto_id: 2, quantidade: 1 }], negociacao: [{ finalizador: 'DINHEIRO', valor: 10 }] }), /não fecha/);
  const id = criarDav(db, { tipo: 'P', itens: [{ produto_id: 2, quantidade: 1 }],
    negociacao: [{ finalizador: 'DINHEIRO', valor: 50 }, { finalizador: 'TROCO', valor: 10.5 }] }).id;
  const n = qryNegociacao(db, id);
  assert.equal(n.ok, true); assert.equal(n.saldo, 0);
});

test('config: valida, grava, restaura e audita', () => {
  const { db } = dbComSeed();
  assert.throws(() => saveConfig(db, { geral: { vias: 9 } }), /inválida/);
  const cfg = getConfig(db); cfg.geral.vias = 2; cfg.grafico.colunas.find((c) => c.key === 'marca').visible = true;
  saveConfig(db, cfg, { usuario: 'ana' });
  assert.equal(getConfig(db).geral.vias, 2);
  assert.equal(getConfig(db).grafico.colunas.find((c) => c.key === 'marca').visible, true);
  restaurarPadroes(db); assert.equal(getConfig(db).geral.vias, DEFAULTS.geral.vias);
  assert.equal(validarConfig(JSON.parse(JSON.stringify(DEFAULTS))).length, 0);
});

test('observação por item: limite de 150 e auditoria', () => {
  const { db, orcId } = dbComSeed();
  const item = db.prepare('SELECT id FROM dav_item WHERE dav_id = ? LIMIT 1').get(orcId);
  assert.throws(() => atualizarObservacaoItem(db, orcId, item.id, 'x'.repeat(151)), /150/);
  atualizarObservacaoItem(db, orcId, item.id, 'Entregar pela manhã', { usuario: 'joao' });
  assert.equal(db.prepare('SELECT observacao FROM dav_item WHERE id = ?').get(item.id).observacao, 'Entregar pela manhã');
  assert.equal(listAudit(db, orcId)[0].acao, 'OBS_ITEM');
  assert.throws(() => atualizarObservacaoItem(db, 999, item.id, 'x'), /não pertence/);
});

test('offline: client_uuid é idempotente', () => {
  const { db } = dbComSeed();
  const p = { client_uuid: 'abc-123', tipo: 'O', itens: [{ produto_id: 2, quantidade: 1 }] };
  const a = criarDav(db, p), b = criarDav(db, p);
  assert.equal(a.id, b.id); assert.equal(b.duplicado, true);
});

test('validade: expira, renova com preço vigente e registra auditoria', () => {
  const { db, orcId } = dbComSeed();
  assert.deepEqual(expirarVencidos(db, { hojeISO: '2027-01-01' }).includes(orcId), true);
  assert.equal(qryPrincipal(db, orcId).status, 'EXPIRADO');
  db.prepare('UPDATE produto SET preco = 50 WHERE id = 2').run();
  const r = recalcularPrecos(db, orcId, { hojeISO: '2027-01-01', usuario: 'ana' });
  assert.equal(r.itensAlterados, 1);
  const d = qryPrincipal(db, orcId); assert.equal(d.status, 'ABERTO'); assert.equal(d.data_validade, '2027-01-08');
  assert.ok(listAudit(db, orcId).some((a) => a.acao === 'RECALCULOU'));
});

test('render gráfico: colunas configuráveis, marca d’água, vias e escape de HTML', () => {
  const { db, orcId } = dbComSeed();
  db.prepare("UPDATE produto SET descricao = 'Tinta <script>x</script>' WHERE id = 1").run();
  const cfg = getConfig(db); cfg.geral.vias = 2; cfg.grafico.colunas.find((c) => c.key === 'marca').visible = true;
  const html = renderGraficoDocumento(obterDavCompleto(db, orcId, cfg), cfg);
  assert.match(html, /ORÇAMENTO – SEM VALOR FISCAL/); assert.match(html, /<th[^>]*>Marca<\/th>/);
  assert.equal((html.match(/class="via"/g) || []).length, 2);
  assert.ok(!html.includes('<script>x'));
});

test('térmico: delimitadores e largura da bobina', () => {
  const { db, orcId } = dbComSeed();
  const cfg = getConfig(db); cfg.geral.formato = 'BOBINA58'; cfg.termico.delimitadorDescricao = '[]';
  const dados = obterDavCompleto(db, orcId, cfg);
  assert.equal(descricaoTermica(dados.itens[0], cfg.termico), 'Tinta acrílica premium fosca 18L [Suvinil]');
  assert.ok(renderTermico(dados, cfg).split('\n').every((l) => l.length <= 32));
});
