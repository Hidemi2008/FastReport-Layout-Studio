import { audit, ACOES } from './audit.js';

const col = (key, label, w, extra = {}) => ({ key, label, visible: false, width: w, align: 'left', fontSize: 9, bold: false, mask: '', ...extra });

// Catálogo completo de colunas disponíveis no modo gráfico (ordem = sequência padrão de exibição).
export const COLUNAS_GRAFICAS = [
  col('seq', 'Item', 5, { visible: true, align: 'center' }),
  col('codigo', 'Código', 9, { visible: true }),
  col('codigo_barras', 'Cód. barras', 12),
  col('imagem', 'Imagem', 10, { align: 'center' }),
  col('descricao', 'Descrição', 34, { visible: true }),
  col('marca', 'Marca', 10),
  col('localizacao', 'Localização', 9),
  col('estoque', 'Estoque', 7, { align: 'right', mask: ',0.00' }),
  col('ambiente', 'Ambiente', 10),
  col('ncm', 'NCM', 9),
  col('situacao_entrega', 'Entrega', 10),
  col('quantidade', 'Qtde', 7, { visible: true, align: 'right', mask: ',0.00' }),
  col('unidade', 'Un', 4, { visible: true, align: 'center' }),
  col('valor_unitario', 'Vl. unit.', 9, { visible: true, align: 'right', mask: 'R$ #,0.00' }),
  col('desconto', 'Desc.', 8, { align: 'right', mask: ',0.00' }),
  col('acrescimo', 'Acrés.', 8, { align: 'right', mask: ',0.00' }),
  col('valor_total', 'Vl. total', 10, { visible: true, align: 'right', bold: true, mask: 'R$ #,0.00' }),
];

export const DEFAULTS = Object.freeze({
  geral: {
    descontoAcrescimoModo: 'FECHAMENTO',          // onde é informado: ITEM | FECHAMENTO
    rateio: 'ITEM',                                // UNIDADE | ITEM | FECHAMENTO
    prioridadeEndereco: ['VENDA', 'CADASTRO', 'COBRANCA', 'PROPRIEDADE', 'CONVENIO'],
    vias: 1,
    modoImpressao: 'GRAFICO',                      // GRAFICO | TERMICO
    formato: 'A4',                                 // A4 | MEIA | BOBINA80 | BOBINA58
    marcaDaguaOrcamento: true,
    textoMarcaDagua: 'ORÇAMENTO – SEM VALOR FISCAL',
    bloquearReimpressao: false,                    // se true, reimpressão exige permissão (ver rota)
    marcarReimpressao: true,
    preencherObservacaoAuto: true,
    textoObservacaoAuto: 'Orçamento válido até a data de validade. Preços sujeitos a alteração sem aviso prévio.',
    autoRedimensionar: true,                       // compacta fontes/margens para caber em 1 página / meia página
    validadeDias: 7,
  },
  grafico: {
    colunas: COLUNAS_GRAFICAS,
    ordenacao: 'SEQUENCIA',                        // SEQUENCIA|CODIGO|DESCRICAO|LOCALIZACAO|MARCA|SITUACAO_ENTREGA|ESTOQUE|AMBIENTE
    totalizarItens: true,
    exibirCodigosIntegrados: false,                // mostra código + barras na mesma célula
    modeloItens: 'SIMPLES',                        // SIMPLES | GRADE | AGRUPADO
    secaoNegociacao: true,
  },
  termico: {
    colunas: { marca: false, localizacao: false, situacao_entrega: false, quantidade: true, precos: true },
    delimitadorDescricao: '()',                    // '()' '[]' '{}' '||' '<>' ou ''
    camposDescricaoComDelimitador: ['marca'],      // campos anexados à descrição entre delimitadores
    larguraCaracteres: { BOBINA80: 48, BOBINA58: 32 },
  },
});

export const ENUMS = {
  rateio: ['UNIDADE', 'ITEM', 'FECHAMENTO'],
  descontoAcrescimoModo: ['ITEM', 'FECHAMENTO'],
  modoImpressao: ['GRAFICO', 'TERMICO'],
  formato: ['A4', 'MEIA', 'BOBINA80', 'BOBINA58'],
  ordenacao: ['SEQUENCIA', 'CODIGO', 'DESCRICAO', 'LOCALIZACAO', 'MARCA', 'SITUACAO_ENTREGA', 'ESTOQUE', 'AMBIENTE'],
  modeloItens: ['SIMPLES', 'GRADE', 'AGRUPADO'],
  delimitador: ['', '()', '[]', '{}', '||', '<>'],
  endereco: ['VENDA', 'CADASTRO', 'COBRANCA', 'PROPRIEDADE', 'CONVENIO'],
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(base) || !isObj(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = k in base ? merge(base[k], over[k]) : over[k];
  return out;
}

export function validarConfig(cfg) {
  const erros = [];
  const g = cfg.geral, gr = cfg.grafico, t = cfg.termico;
  const inEnum = (v, list, nome) => { if (!list.includes(v)) erros.push(`${nome} inválido: ${v}`); };
  inEnum(g.rateio, ENUMS.rateio, 'geral.rateio');
  inEnum(g.descontoAcrescimoModo, ENUMS.descontoAcrescimoModo, 'geral.descontoAcrescimoModo');
  inEnum(g.modoImpressao, ENUMS.modoImpressao, 'geral.modoImpressao');
  inEnum(g.formato, ENUMS.formato, 'geral.formato');
  inEnum(gr.ordenacao, ENUMS.ordenacao, 'grafico.ordenacao');
  inEnum(gr.modeloItens, ENUMS.modeloItens, 'grafico.modeloItens');
  inEnum(t.delimitadorDescricao, ENUMS.delimitador, 'termico.delimitadorDescricao');
  if (!Number.isInteger(g.vias) || g.vias < 1 || g.vias > 5) erros.push('geral.vias deve ser entre 1 e 5');
  if (!Number.isInteger(g.validadeDias) || g.validadeDias < 1 || g.validadeDias > 365) erros.push('geral.validadeDias deve ser entre 1 e 365');
  if (!Array.isArray(g.prioridadeEndereco) || g.prioridadeEndereco.some((e) => !ENUMS.endereco.includes(e))) erros.push('geral.prioridadeEndereco inválida');
  if (!Array.isArray(gr.colunas) || !gr.colunas.length) erros.push('grafico.colunas vazio');
  else {
    const conhecidas = new Set(COLUNAS_GRAFICAS.map((c) => c.key));
    for (const c of gr.colunas) {
      if (!conhecidas.has(c.key)) erros.push(`coluna desconhecida: ${c.key}`);
      if (!(c.width >= 2 && c.width <= 60)) erros.push(`largura inválida em ${c.key}`);
      if (!['left', 'center', 'right'].includes(c.align)) erros.push(`alinhamento inválido em ${c.key}`);
      if (!(c.fontSize >= 6 && c.fontSize <= 24)) erros.push(`fonte inválida em ${c.key}`);
    }
    if (!gr.colunas.some((c) => c.visible)) erros.push('ao menos uma coluna deve estar visível');
  }
  return erros;
}

export function getConfig(db, empresaId = 1) {
  const rows = db.prepare('SELECT chave, valor FROM config_dav WHERE empresa_id = ?').all(empresaId);
  let cfg = clone(DEFAULTS);
  for (const r of rows) cfg[r.chave] = merge(cfg[r.chave], JSON.parse(r.valor));
  return cfg;
}

export function saveConfig(db, parcial, { empresaId = 1, usuario = 'sistema' } = {}) {
  const cfg = merge(clone(DEFAULTS), parcial);
  // substituição total de listas (colunas): merge de arrays não é feito.
  if (parcial?.grafico?.colunas) cfg.grafico.colunas = parcial.grafico.colunas;
  const erros = validarConfig(cfg);
  if (erros.length) { const e = new Error('Configuração inválida'); e.status = 422; e.detalhes = erros; throw e; }
  const up = db.prepare(`INSERT INTO config_dav (empresa_id, chave, valor, atualizado_em) VALUES (?,?,?,datetime('now'))
    ON CONFLICT(empresa_id, chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em`);
  db.transaction(() => {
    for (const k of ['geral', 'grafico', 'termico']) up.run(empresaId, k, JSON.stringify(cfg[k]));
    audit(db, { acao: ACOES.CONFIG, usuario, detalhes: { gravou: Object.keys(parcial || {}) } });
  })();
  return cfg;
}

export function restaurarPadroes(db, { empresaId = 1, usuario = 'sistema' } = {}) {
  db.transaction(() => {
    db.prepare('DELETE FROM config_dav WHERE empresa_id = ?').run(empresaId);
    audit(db, { acao: ACOES.CONFIG, usuario, detalhes: { restaurouPadroes: true } });
  })();
  return clone(DEFAULTS);
}

// Config efetiva para preview: defaults + salvo + rascunho não gravado (sem validar gravação).
export function configComRascunho(db, rascunho) {
  const cfg = merge(getConfig(db), rascunho || {});
  if (rascunho?.grafico?.colunas) cfg.grafico.colunas = rascunho.grafico.colunas;
  return cfg;
}
