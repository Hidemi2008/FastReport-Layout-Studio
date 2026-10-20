import { escapeHtml as h, formatMask, brDate } from './format.js';
import { TIPOS, SITUACOES } from './dav.js';

const brl = (n) => formatMask(n, 'R$ #,0.00');
const imagemSegura = (u) => (/^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,|\/)/i.test(u || '') ? u : null);

// ----------------------------------------------------------------------------------------
// MODO GRÁFICO (A4 / Meia página)
// ----------------------------------------------------------------------------------------
function celula(col, it, cfg) {
  const v = it[col.key];
  if (col.key === 'imagem') { const u = imagemSegura(v); return u ? `<img src="${h(u)}" alt="" style="max-width:100%;max-height:14mm">` : ''; }
  if (col.key === 'codigo' && cfg.grafico.exibirCodigosIntegrados) return `${h(it.codigo)}${it.codigo_barras ? `<br><small>${h(it.codigo_barras)}</small>` : ''}`;
  if (col.key === 'descricao') {
    const pre = it.tipo_linha === 'COMPONENTE' ? '&nbsp;&nbsp;↳ ' : '';
    const obs = it.observacao ? `<br><small><i>Obs.: ${h(it.observacao)}</i></small>` : '';
    return `${pre}${h(it.descricao)}${obs}`;
  }
  if (col.key === 'situacao_entrega') return h(SITUACOES[it.situacao_entrega] || '');
  if (it.tipo_linha === 'COMPONENTE' && ['valor_unitario', 'valor_total', 'desconto', 'acrescimo'].includes(col.key)) return '';
  if (col.mask) return h(formatMask(it[col.key], col.mask));
  return h(v ?? '');
}

export function renderGrafico({ doc, itens, negociacao, empresa }, cfg, { reimpressao = false, nomeVia = 1 } = {}) {
  const g = cfg.geral;
  const meia = g.formato === 'MEIA';
  const colunas = cfg.grafico.colunas.filter((c) => c.visible);
  const soma = colunas.reduce((s, c) => s + Number(c.width), 0) || 1;
  const cap = meia ? 12 : 30;
  const escala = g.autoRedimensionar ? Math.max(0.7, Math.min(1, cap / Math.max(itens.length, 1))) : 1;
  const mostrarMarca = g.marcaDaguaOrcamento && doc.tipo === 'O';
  const rotulo = `${doc.tipo_info.sigla} · ${doc.tipo_info.nome}`;

  const thead = colunas.map((c) => `<th style="width:${((c.width / soma) * 100).toFixed(2)}%;text-align:${c.align};font-size:${(c.fontSize * escala).toFixed(1)}pt">${h(c.label)}</th>`).join('');
  const linhas = itens.map((it) => `<tr class="${it.tipo_linha.toLowerCase()}">${colunas.map((c) =>
    `<td style="text-align:${c.align};font-size:${(c.fontSize * escala).toFixed(1)}pt;${c.bold || it.tipo_linha === 'KIT' ? 'font-weight:700' : ''}">${celula(c, it, cfg)}</td>`).join('')}</tr>`).join('');

  const totalQtd = itens.filter((i) => i.tipo_linha !== 'COMPONENTE').reduce((s, i) => s + i.quantidade, 0);
  const totais = [
    cfg.grafico.totalizarItens && ['Itens / quantidade', `${itens.filter((i) => i.tipo_linha !== 'COMPONENTE').length} / ${formatMask(totalQtd, ',0.00')}`],
    ['Total bruto', brl(doc.total_bruto)],
    doc.total_desconto > 0 && ['Descontos', `- ${brl(doc.total_desconto)}`],
    doc.total_acrescimo > 0 && ['Acréscimos', `+ ${brl(doc.total_acrescimo)}`],
    doc.frete > 0 && ['Frete', `+ ${brl(doc.frete)}`],
  ].filter(Boolean);

  const neg = cfg.grafico.secaoNegociacao && negociacao.parcelas.length ? `
    <h3>Negociação</h3><table class="neg"><tr><th>Forma</th><th>Parcela</th><th>Vencimento</th><th style="text-align:right">Valor</th></tr>
    ${negociacao.parcelas.map((p) => `<tr><td>${h(p.finalizador)}</td><td>${p.parcela}</td><td>${brDate(p.vencimento)}</td><td style="text-align:right">${brl(p.valor)}</td></tr>`).join('')}
    </table><p class="${negociacao.ok ? 'ok' : 'warn'}">${h(negociacao.mensagem)}</p>` : '';

  const reimp = reimpressao && g.marcarReimpressao ? `<div class="reimp">REIMPRESSÃO · ${doc.vias_impressas + 1}ª emissão</div>` : '';

  return `<section class="via" style="--escala:${escala}">
    ${mostrarMarca ? `<div class="marca">${h(g.textoMarcaDagua)}</div>` : ''}
    <header><div><strong class="emp">${h(empresa.fantasia || empresa.razao_social || '')}</strong><br>
      <small>${h(empresa.razao_social || '')} · CNPJ ${h(empresa.cnpj || '')}<br>${h(empresa.endereco || '')} · ${h(empresa.telefone || '')}</small></div>
      <div class="tit"><strong>${h(rotulo)}</strong><br>Nº ${h(doc.numero)}<br><small>Emissão ${brDate(doc.data_emissao)}${doc.data_validade ? ` · Validade ${brDate(doc.data_validade)}` : ''}</small>
      ${g.vias > 1 ? `<br><small>Via ${nomeVia}/${g.vias}</small>` : ''}</div></header>
    ${reimp}
    <div class="cli"><strong>Cliente:</strong> ${h(doc.cliente_nome || 'Consumidor')} ${doc.cliente_documento ? `· ${h(doc.cliente_documento)}` : ''} ${doc.cliente_telefone ? `· ${h(doc.cliente_telefone)}` : ''}<br>
      ${doc.convenio_nome ? `<strong>Convênio:</strong> ${h(doc.convenio_nome)} ` : ''}${doc.parceiro_nome ? `<strong>Parceiro:</strong> ${h(doc.parceiro_nome)} ` : ''}${doc.propriedade_nome ? `<strong>${doc.propriedade_tipo === 'RURAL' ? 'Propriedade rural' : 'Propriedade comercial'}:</strong> ${h(doc.propriedade_nome)}` : ''}
      ${doc.endereco_entrega ? `<br><strong>Entrega:</strong> ${h(doc.endereco_entrega)}` : ''}${doc.caixa ? `<br><small>Caixa ${h(doc.caixa)}</small>` : ''}</div>
    <table class="itens"><thead><tr>${thead}</tr></thead><tbody>${linhas}</tbody></table>
    <div class="tot">${totais.map(([k, v]) => `<div><span>${h(k)}</span><span>${h(v)}</span></div>`).join('')}<div class="liq"><span>Total líquido</span><span>${brl(doc.total_liquido)}</span></div></div>
    ${neg}
    ${doc.observacao ? `<p class="obs"><strong>Observações:</strong> ${h(doc.observacao)}</p>` : ''}
    <footer>${h(empresa.rodape_legal || 'Documento auxiliar de venda – não possui valor fiscal.')}</footer></section>`;
}

export function renderGraficoDocumento(data, cfg, opts = {}) {
  const meia = cfg.geral.formato === 'MEIA';
  const vias = Array.from({ length: cfg.geral.vias }, (_, i) => renderGrafico(data, cfg, { ...opts, nomeVia: i + 1 })).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${h(data.doc.tipo_info.sigla)} ${h(data.doc.numero)}</title><style>
  @page{size:${meia ? '210mm 148mm' : 'A4'};margin:8mm}
  *{box-sizing:border-box}body{font:10pt/1.3 "Segoe UI",Arial,sans-serif;color:#111;margin:0}
  .via{position:relative;page-break-after:always;padding:2mm;min-height:${meia ? '128mm' : '275mm'};overflow:hidden}.via:last-child{page-break-after:auto}
  header{display:flex;justify-content:space-between;border-bottom:2px solid #14213d;padding-bottom:4px;margin-bottom:6px}.emp{font-size:13pt}.tit{text-align:right}
  .cli{border:1px solid #bbb;padding:4px 6px;margin:6px 0;font-size:9pt}
  table{width:100%;border-collapse:collapse}table.itens th{background:#14213d;color:#fff;padding:3px 4px}table.itens td{border-bottom:1px solid #ddd;padding:2px 4px;vertical-align:top}
  tr.componente td{color:#555}tr.kit td{background:#f1f3f8}
  .tot{margin:8px 0 0 auto;width:55%}.tot div{display:flex;justify-content:space-between;padding:1px 0}.tot .liq{border-top:2px solid #14213d;font-weight:700;font-size:12pt;margin-top:3px;padding-top:3px}
  h3{margin:8px 0 2px;font-size:10pt}table.neg td,table.neg th{border-bottom:1px solid #ddd;padding:2px 4px;text-align:left;font-size:9pt}
  .ok{color:#1b6e3a}.warn{color:#a35a00}.obs{font-size:9pt}footer{margin-top:8px;border-top:1px solid #bbb;padding-top:3px;font-size:8pt;color:#555}
  .marca{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;transform:rotate(-30deg);font-size:34pt;font-weight:800;color:rgba(20,33,61,.08);pointer-events:none;text-align:center}
  .reimp{background:#fff3cd;border:1px solid #e0b100;padding:2px 6px;font-weight:700;font-size:9pt;text-align:center}
  @media print{.noprint{display:none}}</style></head><body>${vias}</body></html>`;
}

// ----------------------------------------------------------------------------------------
// MODO TÉRMICO (bobina 58/80mm) – texto monoespaçado
// ----------------------------------------------------------------------------------------
const DELIM = { '()': ['(', ')'], '[]': ['[', ']'], '{}': ['{', '}'], '||': ['|', '|'], '<>': ['<', '>'], '': ['', ''] };
const sem = (s) => String(s ?? '');
const dir = (s, w) => sem(s).slice(0, w).padStart(w);
const esq = (s, w) => sem(s).slice(0, w).padEnd(w);
const par = (a, b, w) => { a = sem(a).slice(0, Math.max(0, w - sem(b).length - 1)); const sp = Math.max(1, w - a.length - b.length); return a + ' '.repeat(sp) + b; };
const quebra = (s, w) => { const t = sem(s); const ind = (t.match(/^ */) || [''])[0]; const larg = w - ind.length; const out = []; let cur = '';
  for (const palavra of t.trim().split(/\s+/)) { if ((cur + ' ' + palavra).trim().length > larg) { if (cur) out.push(cur); cur = palavra.slice(0, larg); } else cur = (cur + ' ' + palavra).trim(); }
  if (cur) out.push(cur); return out.map((l) => ind + l); };
const centro = (s, w) => { const t = sem(s).slice(0, w); return ' '.repeat(Math.floor((w - t.length) / 2)) + t; };

export function descricaoTermica(it, t) {
  const [a, b] = DELIM[t.delimitadorDescricao] ?? DELIM[''];
  const extras = (t.camposDescricaoComDelimitador || []).map((k) => it[k]).filter(Boolean).map((v) => `${a}${v}${b}`);
  return [it.descricao, ...extras].join(' ');
}

export function renderTermico({ doc, itens, negociacao, empresa }, cfg, { reimpressao = false } = {}) {
  const W = cfg.termico.larguraCaracteres[cfg.geral.formato === 'BOBINA58' ? 'BOBINA58' : 'BOBINA80'] || 48;
  const t = cfg.termico; const c = t.colunas; const L = []; const sep = '-'.repeat(W);
  L.push(centro(empresa.fantasia || empresa.razao_social || '', W), centro(`CNPJ ${empresa.cnpj || ''}`, W), sep);
  L.push(centro(`${doc.tipo_info.sigla} ${doc.tipo_info.nome.toUpperCase()}`, W), centro(`Nº ${doc.numero}`, W));
  L.push(par(`Emissao ${brDate(doc.data_emissao)}`, doc.data_validade ? `Val. ${brDate(doc.data_validade)}` : '', W));
  if (cfg.geral.marcaDaguaOrcamento && doc.tipo === 'O') L.push(centro(`*** ${cfg.geral.textoMarcaDagua} ***`.slice(0, W), W));
  if (reimpressao && cfg.geral.marcarReimpressao) L.push(centro(`** REIMPRESSAO (${doc.vias_impressas + 1}a) **`, W));
  L.push(sep, ...quebra(`Cliente: ${doc.cliente_nome || 'Consumidor'}`, W));
  if (doc.endereco_entrega) L.push(...quebra(`Entrega: ${doc.endereco_entrega}`, W));
  L.push(sep);
  for (const it of itens) {
    const comp = it.tipo_linha === 'COMPONENTE';
    L.push(...quebra(`${String(it.seq).padStart(2, '0')} ${it.codigo} ${comp ? '  > ' : ''}${descricaoTermica(it, t)}`, W));
    const meta = [];
    if (c.marca && it.marca) meta.push(it.marca);
    if (c.localizacao && it.localizacao) meta.push(`Loc ${it.localizacao}`);
    if (c.situacao_entrega) meta.push(SITUACOES[it.situacao_entrega]);
    if (meta.length) L.push(...quebra(`   ${meta.join(' | ')}`, W));
    if (!comp && (c.quantidade || c.precos)) {
      const esquerda = [c.quantidade && `${formatMask(it.quantidade, ',0.##')} ${it.unidade}`, c.precos && `x ${formatMask(it.valor_unitario, ',0.00')}`].filter(Boolean).join(' ');
      L.push(par(`   ${esquerda}`, c.precos ? formatMask(it.valor_total, ',0.00') : '', W));
    }
    if (it.observacao) L.push(...quebra(`   Obs: ${it.observacao}`, W));
  }
  L.push(sep);
  L.push(par('Bruto', formatMask(doc.total_bruto, ',0.00'), W));
  if (doc.total_desconto > 0) L.push(par('Descontos', `-${formatMask(doc.total_desconto, ',0.00')}`, W));
  if (doc.total_acrescimo > 0) L.push(par('Acrescimos', `+${formatMask(doc.total_acrescimo, ',0.00')}`, W));
  if (doc.frete > 0) L.push(par('Frete', `+${formatMask(doc.frete, ',0.00')}`, W));
  L.push(par('TOTAL LIQUIDO', brl(doc.total_liquido), W));
  if (negociacao.parcelas.length) {
    L.push(sep);
    for (const p of negociacao.parcelas) L.push(par(`${p.finalizador} ${p.parcela}x ${brDate(p.vencimento)}`, formatMask(p.valor, ',0.00'), W));
  }
  if (doc.observacao) L.push(sep, ...quebra(doc.observacao, W));
  L.push(sep, centro('Sem valor fiscal', W), '', '');
  return L.join('\n');
}

export const renderTermicoDocumento = (data, cfg, opts) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Térmico</title><style>
  body{margin:0;background:#eee;display:flex;justify-content:center}pre{background:#fff;padding:8px 10px;font:12px/1.25 "Courier New",monospace;margin:8px;box-shadow:0 0 0 1px #ccc}
  @media print{body{background:#fff}pre{box-shadow:none;margin:0}}</style></head><body><pre>${h(renderTermico(data, cfg, opts))}</pre></body></html>`;

export function renderDocumento(data, cfg, opts = {}) {
  return cfg.geral.modoImpressao === 'TERMICO' || ['BOBINA80', 'BOBINA58'].includes(cfg.geral.formato)
    ? renderTermicoDocumento(data, cfg, opts) : renderGraficoDocumento(data, cfg, opts);
}

export function renderDocumentoSeguro(data, cfg, opts = {}) {
  try {
    if (!data?.doc || !cfg?.geral) {
      const error = new Error('Dados insuficientes para renderizar o relatório.');
      error.status = 422;
      throw error;
    }
    return renderDocumento(data, cfg, opts);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'report_render_failed', documentId: data?.doc?.id || null, error: error.message }));
    if (!error.status) error.status = 422;
    throw error;
  }
}
