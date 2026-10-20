import { round2 } from './format.js';
import { getConfig } from './config.js';
import { audit, ACOES } from './audit.js';

export const TIPOS = Object.freeze({
  C: { sigla: 'DAV-C', nome: 'Condicional' },
  O: { sigla: 'DAV-O', nome: 'Orçamento' },
  P: { sigla: 'DAV-P', nome: 'Pedido' },
});
export const SITUACOES = Object.freeze({ NA_LOJA: 'Na loja', A_ENTREGAR: 'A entregar', A_RETIRAR: 'A retirar', NO_CLIENTE: 'No cliente' });

// ---------- Expressões SQL dependentes da configuração de rateio ----------
// Nunca interpolamos valores do usuário: apenas fragmentos de uma lista fechada.
function exprAjusteItem(cfg) {
  const porUnidade = cfg.geral.descontoAcrescimoModo === 'ITEM' && cfg.geral.rateio === 'UNIDADE';
  const mult = porUnidade ? ' * i.quantidade' : '';
  return { desc: `i.desconto${mult}`, acr: `i.acrescimo${mult}` };
}

// ---------- QryPrincipal ----------
export function qryPrincipal(db, davId, cfg = getConfig(db)) {
  const { desc, acr } = exprAjusteItem(cfg);
  const row = db.prepare(`
    SELECT d.*,
      c.nome AS cliente_nome, c.documento AS cliente_documento, c.telefone AS cliente_telefone, c.email AS cliente_email,
      c.endereco_cadastro, c.endereco_cobranca,
      cv.nome AS convenio_nome, cv.endereco_cadastro AS convenio_endereco,
      pa.nome AS parceiro_nome,
      pr.nome AS propriedade_nome, pr.tipo AS propriedade_tipo, pr.endereco AS propriedade_endereco,
      COALESCE((SELECT ROUND(SUM(i.quantidade * i.valor_unitario), 2) FROM dav_item i WHERE i.dav_id = d.id AND i.kit_pai_item_id IS NULL), 0) AS total_bruto,
      COALESCE((SELECT ROUND(SUM(${desc}), 2) FROM dav_item i WHERE i.dav_id = d.id AND i.kit_pai_item_id IS NULL), 0) AS total_desconto_itens,
      COALESCE((SELECT ROUND(SUM(${acr}), 2) FROM dav_item i WHERE i.dav_id = d.id AND i.kit_pai_item_id IS NULL), 0) AS total_acrescimo_itens,
      (SELECT COUNT(*) FROM dav_item i WHERE i.dav_id = d.id) AS qtd_linhas
    FROM dav d
    LEFT JOIN cliente c  ON c.id  = d.cliente_id
    LEFT JOIN cliente cv ON cv.id = d.convenio_cliente_id
    LEFT JOIN cliente pa ON pa.id = d.parceiro_cliente_id
    LEFT JOIN propriedade pr ON pr.id = d.propriedade_id
    WHERE d.id = ?`).get(davId);
  if (!row) return null;
  row.total_desconto = round2(row.total_desconto_itens + row.desconto_fechamento);
  row.total_acrescimo = round2(row.total_acrescimo_itens + row.acrescimo_fechamento);
  row.total_liquido = round2(row.total_bruto - row.total_desconto + row.total_acrescimo + row.frete);
  row.tipo_info = TIPOS[row.tipo];
  row.endereco_entrega = resolverEndereco(row, cfg.geral.prioridadeEndereco);
  return row;
}

export function resolverEndereco(r, prioridade) {
  const map = { VENDA: r.endereco_venda, CADASTRO: r.endereco_cadastro, COBRANCA: r.endereco_cobranca, PROPRIEDADE: r.propriedade_endereco, CONVENIO: r.convenio_endereco };
  for (const p of prioridade) if (map[p] && String(map[p]).trim()) return map[p];
  return '';
}

// ---------- QryItens ----------
// Ordenação em lista branca (sem interpolar entrada do usuário).
const ORDENACAO = {
  SEQUENCIA: 'grupo_seq, eh_componente, seq',
  CODIGO: 'COALESCE(pp.codigo, p.codigo), eh_componente, seq',
  DESCRICAO: 'COALESCE(pp.descricao, p.descricao), eh_componente, seq',
  LOCALIZACAO: 'COALESCE(pp.localizacao, p.localizacao), eh_componente, seq',
  MARCA: 'COALESCE(pp.marca, p.marca), eh_componente, seq',
  SITUACAO_ENTREGA: 'situacao_entrega, grupo_seq, eh_componente, seq',
  ESTOQUE: 'estoque DESC, grupo_seq, eh_componente, seq',
  AMBIENTE: 'ambiente, grupo_seq, eh_componente, seq',
};

const DESC_EXPR = {
  SIMPLES: 'p.descricao',
  GRADE: `COALESCE(p.descricao_reduzida, p.descricao) || CASE WHEN p.grade1 IS NOT NULL THEN ' - ' || p.grade1 ELSE '' END || CASE WHEN p.grade2 IS NOT NULL THEN '/' || p.grade2 ELSE '' END`,
};
DESC_EXPR.AGRUPADO = DESC_EXPR.GRADE;

export function qryItens(db, davId, cfg = getConfig(db), doc = qryPrincipal(db, davId, cfg)) {
  const modelo = cfg.grafico.modeloItens;
  const ordem = ORDENACAO[cfg.grafico.ordenacao] || ORDENACAO.SEQUENCIA;
  const agrupar = modelo === 'AGRUPADO';
  // chave de fusão: só funde linhas "limpas" (sem desconto/acréscimo/obs) e que não sejam kit
  const mergeKey = agrupar ? `CASE WHEN i.desconto = 0 AND i.acrescimo = 0 AND i.observacao IS NULL AND p.eh_kit = 0 THEN 0 ELSE i.id END` : 'i.id';
  const rows = db.prepare(`
    SELECT MIN(i.id) AS id, MIN(i.seq) AS seq, i.produto_id, SUM(i.quantidade) AS quantidade, i.valor_unitario,
      SUM(i.desconto) AS desconto, SUM(i.acrescimo) AS acrescimo, i.situacao_entrega, i.deposito, i.kit_pai_item_id, i.observacao,
      p.codigo, p.codigo_barras, ${DESC_EXPR[modelo]} AS descricao, p.marca, p.ncm, p.unidade, p.imagem, p.eh_kit,
      TRIM(COALESCE(p.localizacao, '') || CASE WHEN i.deposito IS NOT NULL THEN ' / ' || i.deposito ELSE '' END, ' /') AS localizacao,
      COALESCE((SELECT SUM(e.quantidade) FROM estoque e WHERE e.produto_id = p.id AND (i.deposito IS NULL OR e.deposito = i.deposito)), 0) AS estoque,
      COALESCE(a.nome, '') AS ambiente,
      CASE WHEN i.kit_pai_item_id IS NULL THEN 0 ELSE 1 END AS eh_componente,
      COALESCE(pi.seq, MIN(i.seq)) AS grupo_seq
    FROM dav_item i
    JOIN produto p ON p.id = i.produto_id
    LEFT JOIN ambiente a ON a.id = i.ambiente_id
    LEFT JOIN dav_item pi ON pi.id = i.kit_pai_item_id
    LEFT JOIN produto pp ON pp.id = pi.produto_id
    WHERE i.dav_id = ?
    GROUP BY ${mergeKey}, i.produto_id, i.valor_unitario, i.situacao_entrega, i.deposito, i.ambiente_id, i.kit_pai_item_id
    ORDER BY ${ordem}`).all(davId);
  return calcularItens(rows, doc, cfg);
}

// Aplica desconto/acréscimo por item e rateio do fechamento (maior resto no último item).
export function calcularItens(rows, doc, cfg) {
  const { rateio, descontoAcrescimoModo } = cfg.geral;
  const porUnidade = descontoAcrescimoModo === 'ITEM' && rateio === 'UNIDADE';
  const itens = rows.map((r) => {
    const bruto = round2(r.quantidade * r.valor_unitario);
    const desconto = round2(r.desconto * (porUnidade ? r.quantidade : 1));
    const acrescimo = round2(r.acrescimo * (porUnidade ? r.quantidade : 1));
    return { ...r, tipo_linha: r.eh_componente ? 'COMPONENTE' : r.eh_kit ? 'KIT' : 'ITEM',
      situacao_label: SITUACOES[r.situacao_entrega], total_bruto: bruto, desconto, acrescimo,
      desconto_fechamento_rateado: 0, acrescimo_fechamento_rateado: 0 };
  });
  // Componentes de kit não participam do rateio (o kit mestre carrega o valor).
  const base = itens.filter((i) => i.tipo_linha !== 'COMPONENTE' && i.total_bruto > 0);
  if (rateio !== 'FECHAMENTO' && base.length) {
    const soma = base.reduce((s, i) => s + i.total_bruto, 0);
    for (const [campo, total] of [['desconto_fechamento_rateado', doc.desconto_fechamento], ['acrescimo_fechamento_rateado', doc.acrescimo_fechamento]]) {
      let restante = round2(total);
      base.forEach((i, idx) => {
        const parte = idx === base.length - 1 ? restante : round2((total * i.total_bruto) / soma);
        i[campo] = parte; restante = round2(restante - parte);
      });
    }
  }
  for (const i of itens) {
    i.valor_total = i.tipo_linha === 'COMPONENTE' ? 0 : round2(i.total_bruto - i.desconto - i.desconto_fechamento_rateado + i.acrescimo + i.acrescimo_fechamento_rateado);
    i.valor_unitario_liquido = i.quantidade ? round2(i.valor_total / i.quantidade) : 0;
  }
  return itens;
}

// ---------- QryNegociacao ----------
export function qryNegociacao(db, davId, cfg = getConfig(db)) {
  const doc = qryPrincipal(db, davId, cfg);
  const parcelas = db.prepare('SELECT * FROM dav_negociacao WHERE dav_id = ? ORDER BY vencimento, parcela, id').all(davId);
  const pago = round2(parcelas.filter((p) => p.finalizador !== 'TROCO').reduce((s, p) => s + p.valor, 0));
  const troco = round2(parcelas.filter((p) => p.finalizador === 'TROCO').reduce((s, p) => s + p.valor, 0));
  const saldo = round2((doc?.total_liquido ?? 0) - (pago - troco));
  return { parcelas, total_pago: pago, troco, saldo, ok: parcelas.length > 0 && Math.abs(saldo) < 0.005,
    mensagem: Math.abs(saldo) < 0.005 ? 'Negociação fecha com o valor líquido.' : saldo > 0 ? `Faltam R$ ${saldo.toFixed(2)} para fechar o valor líquido.` : `Excede em R$ ${Math.abs(saldo).toFixed(2)} (considere lançar troco).` };
}

export function validarNegociacaoLista(lista, liquido) {
  const pago = lista.filter((p) => p.finalizador !== 'TROCO').reduce((s, p) => s + Number(p.valor), 0);
  const troco = lista.filter((p) => p.finalizador === 'TROCO').reduce((s, p) => s + Number(p.valor), 0);
  const saldo = round2(liquido - (pago - troco));
  return { ok: Math.abs(saldo) < 0.005, saldo };
}

// ---------- Criação / leitura ----------
function dataMaisDias(iso, dias) { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + dias); return d.toISOString().slice(0, 10); }

export function criarDav(db, p, { usuario = 'sistema', ip = null } = {}) {
  if (p.client_uuid) {
    const ja = db.prepare('SELECT id FROM dav WHERE client_uuid = ?').get(p.client_uuid);
    if (ja) return { id: ja.id, duplicado: true };
  }
  if (!TIPOS[p.tipo]) throw Object.assign(new Error('Tipo inválido (use C, O ou P)'), { status: 422 });
  if (!Array.isArray(p.itens) || !p.itens.length) throw Object.assign(new Error('O documento precisa de ao menos um item'), { status: 422 });
  const cfg = getConfig(db);
  const emissao = p.data_emissao || new Date().toISOString().slice(0, 10);
  const validade = p.data_validade || (p.tipo === 'P' ? null : dataMaisDias(emissao, cfg.geral.validadeDias));
  const obs = p.observacao ?? (cfg.geral.preencherObservacaoAuto && p.tipo !== 'P' ? cfg.geral.textoObservacaoAuto : null);

  return db.transaction(() => {
    const info = db.prepare(`INSERT INTO dav (client_uuid, tipo, caixa, cliente_id, convenio_cliente_id, parceiro_cliente_id, propriedade_id,
        endereco_venda, data_emissao, data_validade, frete, desconto_fechamento, acrescimo_fechamento, observacao, criado_por)
      VALUES (@client_uuid,@tipo,@caixa,@cliente_id,@convenio_cliente_id,@parceiro_cliente_id,@propriedade_id,@endereco_venda,@data_emissao,
        @data_validade,@frete,@desconto_fechamento,@acrescimo_fechamento,@observacao,@criado_por)`).run({
      client_uuid: p.client_uuid ?? null, tipo: p.tipo, caixa: p.caixa ?? null, cliente_id: p.cliente_id ?? null,
      convenio_cliente_id: p.convenio_cliente_id ?? null, parceiro_cliente_id: p.parceiro_cliente_id ?? null, propriedade_id: p.propriedade_id ?? null,
      endereco_venda: p.endereco_venda ?? null, data_emissao: emissao, data_validade: validade, frete: p.frete ?? 0,
      desconto_fechamento: p.desconto_fechamento ?? 0, acrescimo_fechamento: p.acrescimo_fechamento ?? 0, observacao: obs, criado_por: usuario });
    const id = Number(info.lastInsertRowid);
    db.prepare('UPDATE dav SET numero = ? WHERE id = ?').run(`${p.tipo}${emissao.slice(0, 4)}${String(id).padStart(6, '0')}`, id);

    const insItem = db.prepare(`INSERT INTO dav_item (dav_id, seq, produto_id, quantidade, valor_unitario, desconto, acrescimo, ambiente_id, deposito, situacao_entrega, kit_pai_item_id, observacao)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    const idPorSeq = new Map();
    p.itens.forEach((it, idx) => {
      const seq = idx + 1;
      const prod = db.prepare('SELECT preco FROM produto WHERE id = ?').get(it.produto_id);
      if (!prod) throw Object.assign(new Error(`Produto ${it.produto_id} não existe`), { status: 422 });
      if (!(it.quantidade > 0)) throw Object.assign(new Error(`Quantidade inválida no item ${seq}`), { status: 422 });
      if (it.observacao && it.observacao.length > 150) throw Object.assign(new Error(`Observação do item ${seq} excede 150 caracteres`), { status: 422 });
      const pai = it.kit_pai_seq ? idPorSeq.get(it.kit_pai_seq) ?? null : null;
      const r = insItem.run(id, seq, it.produto_id, it.quantidade, it.valor_unitario ?? (pai ? 0 : prod.preco), it.desconto ?? 0, it.acrescimo ?? 0,
        it.ambiente_id ?? null, it.deposito ?? null, it.situacao_entrega ?? 'NA_LOJA', pai, it.observacao ?? null);
      idPorSeq.set(seq, Number(r.lastInsertRowid));
    });

    const doc = qryPrincipal(db, id, cfg);
    if (p.negociacao?.length) {
      const v = validarNegociacaoLista(p.negociacao, doc.total_liquido);
      if (!v.ok && p.tipo === 'P') throw Object.assign(new Error(`Negociação não fecha com o líquido (saldo ${v.saldo})`), { status: 422 });
      const insN = db.prepare('INSERT INTO dav_negociacao (dav_id, finalizador, parcela, vencimento, valor) VALUES (?,?,?,?,?)');
      for (const n of p.negociacao) insN.run(id, n.finalizador, n.parcela ?? 1, n.vencimento ?? null, n.valor);
    }
    audit(db, { davId: id, acao: ACOES.CRIOU, usuario, ip, detalhes: { tipo: p.tipo, total: doc.total_liquido, offline: !!p.client_uuid } });
    return { id, duplicado: false };
  })();
}

export function obterDavCompleto(db, id, cfg = getConfig(db)) {
  const doc = qryPrincipal(db, id, cfg);
  if (!doc) return null;
  return { doc, itens: qryItens(db, id, cfg, doc), negociacao: qryNegociacao(db, id, cfg),
    empresa: db.prepare('SELECT * FROM empresa WHERE id = 1').get() || {} };
}

export function atualizarObservacaoItem(db, davId, itemId, texto, { usuario = 'sistema', ip = null } = {}) {
  const t = texto == null ? null : String(texto).trim();
  if (t && t.length > 150) throw Object.assign(new Error('Observação excede 150 caracteres'), { status: 422 });
  const item = db.prepare('SELECT id, observacao FROM dav_item WHERE id = ? AND dav_id = ?').get(itemId, davId);
  if (!item) throw Object.assign(new Error('Item não pertence a este documento'), { status: 404 });
  db.transaction(() => {
    db.prepare('UPDATE dav_item SET observacao = ? WHERE id = ?').run(t || null, itemId);
    db.prepare("UPDATE dav SET atualizado_em = datetime('now') WHERE id = ?").run(davId);
    audit(db, { davId, acao: ACOES.OBS_ITEM, usuario, ip, detalhes: { itemId, de: item.observacao, para: t || null } });
  })();
}

export function listarDavs(db, { tipo, status, limite = 100 } = {}) {
  const w = []; const a = [];
  if (tipo) { w.push('d.tipo = ?'); a.push(tipo); }
  if (status) { w.push('d.status = ?'); a.push(status); }
  return db.prepare(`SELECT d.id, d.numero, d.tipo, d.status, d.data_emissao, d.data_validade, c.nome AS cliente_nome, d.vias_impressas,
      (SELECT ROUND(SUM(quantidade*valor_unitario),2) FROM dav_item WHERE dav_id = d.id AND kit_pai_item_id IS NULL) AS total_bruto
    FROM dav d LEFT JOIN cliente c ON c.id = d.cliente_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''}
    ORDER BY d.id DESC LIMIT ?`).all(...a, Math.min(Number(limite) || 100, 500));
}
