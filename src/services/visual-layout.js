const FORMATOS = new Set(['A4', 'BOBINA80', 'BOBINA58']);
const TIPOS = new Set(['header', 'logo', 'cliente', 'itens', 'totais', 'pagamento', 'texto', 'rodape']);
const DEFAULT_STYLE = Object.freeze({
  fontFamily: 'Arial', fontSize: 14, fontWeight: '400', textAlign: 'left',
  color: '#14213d', background: 'transparent', borderColor: '#cfd6e0',
  borderWidth: 0, padding: 6,
});

export const DEFAULT_VISUAL_LAYOUT = Object.freeze({
  nome: 'Novo layout', formato: 'A4',
  elementos: [
    { id: 'header-1', tipo: 'header', titulo: 'Cabeçalho', x: 30, y: 24, largura: 734, altura: 70, estilo: { ...DEFAULT_STYLE, fontSize: 22, fontWeight: '700' } },
    { id: 'cliente-1', tipo: 'cliente', titulo: 'Dados do cliente', x: 30, y: 112, largura: 734, altura: 92, estilo: { ...DEFAULT_STYLE, borderWidth: 1 } },
    { id: 'itens-1', tipo: 'itens', titulo: 'Itens', x: 30, y: 220, largura: 734, altura: 330, estilo: { ...DEFAULT_STYLE, borderWidth: 1 } },
    { id: 'totais-1', tipo: 'totais', titulo: 'Totais', x: 470, y: 570, largura: 294, altura: 120, estilo: { ...DEFAULT_STYLE, fontWeight: '700' } },
    { id: 'rodape-1', tipo: 'rodape', titulo: 'Rodapé', x: 30, y: 1040, largura: 734, altura: 45, estilo: { ...DEFAULT_STYLE, fontSize: 11, textAlign: 'center' } },
  ],
});

function erro(msg, status = 422) { const e = new Error(msg); e.status = status; return e; }
const clone = (value) => JSON.parse(JSON.stringify(value));

export function validarVisualLayout(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.elementos)) throw erro('Estrutura visual inválida.');
  if (!FORMATOS.has(input.formato)) throw erro('Formato visual inválido.');
  if (input.elementos.length > 100) throw erro('O layout não pode ter mais de 100 elementos.');
  const ids = new Set();
  for (const item of input.elementos) {
    if (!item.id || ids.has(item.id) || !TIPOS.has(item.tipo)) throw erro('Elemento visual inválido ou duplicado.');
    ids.add(item.id);
    for (const key of ['x', 'y', 'largura', 'altura']) if (!Number.isFinite(Number(item[key])) || Number(item[key]) < 0) throw erro(`Coordenada inválida: ${key}.`);
    if (item.largura < 20 || item.altura < 12 || item.largura > 2000 || item.altura > 2000) throw erro('Dimensão visual fora do limite.');
  }
  return input;
}

export function obterVisualLayout(db) {
  const row = db.prepare('SELECT nome, formato, estrutura_json, atualizado_em FROM visual_layout WHERE id = 1').get();
  return row ? { nome: row.nome, formato: row.formato, ...JSON.parse(row.estrutura_json), atualizado_em: row.atualizado_em } : clone(DEFAULT_VISUAL_LAYOUT);
}

export function salvarVisualLayout(db, input) {
  const value = validarVisualLayout(input);
  db.prepare(`INSERT INTO visual_layout (id,nome,formato,estrutura_json,atualizado_em)
    VALUES (1,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET nome=excluded.nome,formato=excluded.formato,estrutura_json=excluded.estrutura_json,atualizado_em=excluded.atualizado_em`)
    .run(String(value.nome || 'Novo layout').slice(0, 120), value.formato, JSON.stringify(value));
  return obterVisualLayout(db);
}

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const textFor = (element, data) => ({
  header: `${data.empresa.nome} · ${data.documento.tipo} Nº ${data.documento.numero}`,
  logo: data.empresa.nome,
  cliente: `Cliente: ${data.cliente.nome}\nCPF/CNPJ: ${data.cliente.cpf_cnpj}\n${data.cliente.endereco} · ${data.cliente.telefone}`,
  totais: `Total líquido: R$ ${Number(data.documento.total_liquido).toFixed(2)}`,
  pagamento: data.negociacao.map((p) => `${p.forma}: R$ ${Number(p.valor).toFixed(2)}`).join('\n'),
  rodape: data.observacao,
  texto: element.texto || 'Texto livre',
})[element.tipo] || '';

export function renderVisualLayout(layout, data) {
  const elements = layout.elementos.map((item) => {
    const style = { ...DEFAULT_STYLE, ...(item.estilo || {}) };
    const box = `left:${item.x}px;top:${item.y}px;width:${item.largura}px;height:${item.altura}px;font-family:${esc(style.fontFamily)};font-size:${style.fontSize}px;font-weight:${style.fontWeight};text-align:${style.textAlign};color:${esc(style.color)};background:${esc(style.background)};border:${style.borderWidth}px solid ${esc(style.borderColor)};padding:${style.padding}px`;
    if (item.tipo === 'itens') {
      const rows = data.itens.map((i) => `<tr><td>${esc(i.codigo)}</td><td>${esc(i.descricao)}</td><td>${esc(i.quantidade)}</td><td>R$ ${Number(i.valor_total).toFixed(2)}</td></tr>`).join('');
      return `<section class="visual-element" style="${box}"><strong>${esc(item.titulo)}</strong><table><thead><tr><th>Código</th><th>Descrição</th><th>Qtde</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    }
    return `<section class="visual-element" style="${box};white-space:pre-line">${esc(item.texto || textFor(item, data))}</section>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${esc(layout.nome)}</title><style>*{box-sizing:border-box}body{margin:0;background:#e9edf2;font:14px Arial}.page{position:relative;width:794px;min-height:1123px;margin:20px auto;background:#fff;box-shadow:0 2px 10px #999}.visual-element{position:absolute;overflow:hidden}.visual-element table{width:100%;border-collapse:collapse;margin-top:8px;font-size:11px}.visual-element th,.visual-element td{border-bottom:1px solid #cfd6e0;padding:3px;text-align:left}@media print{body{background:#fff}.page{margin:0;box-shadow:none}}</style><main class="page">${elements}</main></html>`;
}
