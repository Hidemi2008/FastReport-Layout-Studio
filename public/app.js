const $ = (selector) => document.querySelector(selector);
const TYPES = [
  ['header', 'Cabeçalho / empresa'], ['logo', 'Logo da empresa'], ['cliente', 'Dados do cliente'],
  ['itens', 'Tabela de itens'], ['totais', 'Totais e descontos'], ['pagamento', 'Formas de pagamento'],
  ['texto', 'Texto livre'], ['rodape', 'Rodapé'],
];
const BANDS = [
  ['header', 'Cabeçalho', ['header', 'logo']],
  ['cliente', 'Dados do cliente', ['cliente']],
  ['itens', 'Itens / QryItens', ['itens']],
  ['totais', 'Totais e descontos', ['totais', 'pagamento']],
  ['rodape', 'Rodapé', ['rodape', 'texto']],
];
const state = { layout: null, dataset: null, selected: null, caminho: null, modo: 'edit', dragged: null };

const api = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.erro || response.statusText);
  return data;
};
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanExpression = (value) => {
  const text = String(value || '').replace(/^\[|\]$/g, '').replace(/\s+/g, ' ').trim();
  const field = text.match(/(?:^|[." ])([A-Za-z_][A-Za-z0-9_]*)["']?\s*$/)?.[1];
  if (/^(?:IIF|IF|FORMAT|SUM|COUNT|DATE|NOW)\b/i.test(text)) return `Fórmula · ${text.slice(0, 34)}${text.length > 34 ? '…' : ''}`;
  return field || text || 'Campo sem texto';
};
function status(message, error = false) { $('#status').textContent = message; $('#status').classList.toggle('erro', error); }
function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('on'); setTimeout(() => node.classList.remove('on'), 2600); }
function nextId(type) { return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }
function defaultElement(type) {
  return { id: nextId(type), tipo: type, titulo: TYPES.find((x) => x[0] === type)?.[1] || 'Elemento',
    x: 35, y: 35, largura: type === 'itens' ? 724 : 300, altura: type === 'itens' ? 240 : 70,
    estilo: { fontFamily: 'Arial', fontSize: 14, fontWeight: '400', textAlign: 'left', color: '#14213d', background: 'transparent', borderColor: '#cfd6e0', borderWidth: type === 'cliente' || type === 'itens' ? 1 : 0, padding: 6 },
    texto: type === 'texto' ? 'Texto livre' : '', mascara: '' };
}
function importedElement(item, index) {
  const type = TYPES.some(([key]) => key === item.tipo) ? item.tipo : 'texto';
  return { ...defaultElement(type), ...item, id: item.id || `imported-${index}`, tipo: type,
    estilo: { ...defaultElement(type).estilo, ...(item.estilo || {}) }, texto: item.texto || item.titulo || '', mascara: item.mascara || '' };
}
function renderLibrary() {
  $('#biblioteca').replaceChildren(...TYPES.map(([type, label]) => {
    const button = document.createElement('button'); button.textContent = `+ ${label}`; button.onclick = () => addElement(type); return button;
  }));
}
function addElement(type, bandKey = 'texto') {
  const item = defaultElement(type); state.layout.elementos.push(item); state.selected = item.id;
  renderBands(); renderProperties(); status(`${TYPES.find(([key]) => key === type)?.[1]} adicionado.`);
}
function itemBand(item) { return BANDS.find(([, , types]) => types.includes(item.tipo))?.[0] || 'texto'; }
function selected() { return state.layout?.elementos.find((item) => item.id === state.selected); }
function itemsForBand(types) { return state.layout.elementos.filter((item) => types.includes(item.tipo)); }
function bandTitle(item) { return item.origem?.dataset ? `${item.titulo} · ${item.origem.dataset}` : item.titulo; }
function fieldCard(item) {
  const card = document.createElement('article'); card.className = `field-card${item.id === state.selected ? ' selected' : ''}`; card.draggable = state.modo === 'edit'; card.dataset.id = item.id;
  card.innerHTML = `<span class="field-grip" aria-label="Reordenar">⠿</span><span class="field-label">${esc(bandTitle(item))}</span><span class="field-preview">${esc(cleanExpression(item.texto || item.titulo))}</span><span class="field-origin">${esc(item.origem?.tag || 'Componente visual')}</span>`;
  card.onclick = () => { state.selected = item.id; renderBands(); renderProperties(); };
  card.ondragstart = (event) => { state.dragged = item.id; event.dataTransfer.effectAllowed = 'move'; };
  card.ondragover = (event) => { event.preventDefault(); };
  card.ondrop = (event) => { event.preventDefault(); reorder(state.dragged, item.id); };
  return card;
}
function itemTable(items) {
  const table = document.createElement('table'); table.className = 'item-table';
  table.innerHTML = '<thead><tr><th class="col-handle"></th><th>Campo</th><th>Expressão resumida</th><th>Origem</th></tr></thead>';
  const body = document.createElement('tbody');
  items.forEach((item) => { const row = document.createElement('tr'); row.className = item.id === state.selected ? 'selected' : ''; row.draggable = state.modo === 'edit'; row.innerHTML = `<td>⠿</td><td>${esc(bandTitle(item))}</td><td class="field-preview">${esc(cleanExpression(item.texto || item.titulo))}</td><td>${esc(item.origem?.dataset || 'QryItens')}</td>`; row.onclick = () => { state.selected = item.id; renderBands(); renderProperties(); }; row.ondragstart = (event) => { state.dragged = item.id; event.dataTransfer.effectAllowed = 'move'; }; row.ondragover = (event) => event.preventDefault(); row.ondrop = (event) => { event.preventDefault(); reorder(state.dragged, item.id); }; body.append(row); });
  table.append(body); return table;
}
function reorder(fromId, toId) {
  if (!fromId || fromId === toId) return;
  const from = state.layout.elementos.findIndex((item) => item.id === fromId); const to = state.layout.elementos.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0 || itemBand(state.layout.elementos[from]) !== itemBand(state.layout.elementos[to])) return;
  const [item] = state.layout.elementos.splice(from, 1); state.layout.elementos.splice(to, 0, item); state.dragged = null; renderBands(); status('Campo reordenado na banda.');
}
function renderBands() {
  const root = $('#gridCanvas'); root.classList.toggle('preview-mode', state.modo === 'preview'); root.replaceChildren();
  for (const [key, title, types] of BANDS) {
    const items = itemsForBand(types); const details = document.createElement('details'); details.className = 'band'; details.open = state.bandOpen?.[key] !== false;
    const summary = document.createElement('summary'); summary.innerHTML = `<span>${title}</span><span class="band-count">${items.length} campo${items.length === 1 ? '' : 's'}</span>`; summary.onclick = () => { state.bandOpen = { ...(state.bandOpen || {}), [key]: !details.open }; };
    const body = document.createElement('div'); body.className = 'band-body';
    if (key === 'itens' && items.length) { const actions = document.createElement('div'); actions.className = 'band-actions'; const add = document.createElement('button'); add.textContent = '+ Campo de item'; add.onclick = () => addElement('texto', key); actions.append(add); body.append(actions, itemTable(items)); }
    else if (items.length) { const grid = document.createElement('div'); grid.className = 'field-grid'; items.forEach((item) => grid.append(fieldCard(item))); body.append(grid); }
    else { body.innerHTML = `<div class="empty-band">Nenhum campo nesta seção. Use a biblioteca para adicionar um componente.</div>`; }
    details.append(summary, body); root.append(details);
  }
}
function field(label, key, value, type = 'text') { return `<label class="campo"><span>${label}</span><input data-key="${key}" type="${type}" value="${esc(value)}"></label>`; }
function renderProperties() {
  const item = selected(); const form = $('#properties'); $('#semSelecao').hidden = !!item; form.hidden = !item; if (!item) return;
  const style = item.estilo || {}; form.innerHTML = `<p class="property-context"><strong>${esc(bandTitle(item))}</strong><small>${esc(item.origem?.tag || 'Componente visual')}</small></p>
    ${field('Rótulo', 'titulo', item.titulo)}<label class="campo"><span>Expressão completa</span><textarea data-key="texto">${esc(item.texto || '')}</textarea></label>
    ${field('Máscara do campo', 'mascara', item.mascara || '')}<div class="prop-grid">${field('Fonte', 'estilo.fontFamily', style.fontFamily)}${field('Tamanho', 'estilo.fontSize', style.fontSize, 'number')}${field('Cor', 'estilo.color', style.color, 'color')}</div>
    <label class="campo"><span>Peso</span><select data-key="estilo.fontWeight"><option value="400" ${style.fontWeight === '400' ? 'selected' : ''}>Normal</option><option value="700" ${style.fontWeight === '700' ? 'selected' : ''}>Negrito</option></select></label>
    <label class="campo"><span>Alinhamento</span><select data-key="estilo.textAlign"><option value="left" ${style.textAlign === 'left' ? 'selected' : ''}>Esquerda</option><option value="center" ${style.textAlign === 'center' ? 'selected' : ''}>Centro</option><option value="right" ${style.textAlign === 'right' ? 'selected' : ''}>Direita</option></select></label>
    <details class="advanced-properties"><summary>Detalhes técnicos</summary><div class="prop-grid">${field('X original', 'x', item.x, 'number')}${field('Y original', 'y', item.y, 'number')}${field('Largura', 'largura', item.largura, 'number')}${field('Altura', 'altura', item.altura, 'number')}</div></details>
    <button type="button" id="removeElement">Remover campo</button>`;
  form.querySelectorAll('[data-key]').forEach((input) => input.oninput = () => { const keys = input.dataset.key.split('.'); let target = item; keys.slice(0, -1).forEach((key) => { target[key] ||= {}; target = target[key]; }); target[keys.at(-1)] = input.type === 'number' ? Number(input.value) : input.value; renderBands(); });
  $('#removeElement').onclick = () => { state.layout.elementos = state.layout.elementos.filter((value) => value.id !== item.id); state.selected = null; renderBands(); renderProperties(); };
}
async function saveLayout() { state.layout.nome = $('#nomeLayout').value || 'Novo layout'; state.layout.formato = $('#formato').value; state.layout = await api('/layout', { method: 'PUT', body: JSON.stringify(state.layout) }); status('Layout estruturado salvo.'); toast('Layout salvo.'); }
async function preview() { const response = await fetch('/api/layout/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ layout: state.layout, dataset: state.dataset }) }); const html = await response.text(); const win = window.open('', '_blank'); if (!win) return toast('Permita a abertura do preview.'); win.document.write(html); win.document.close(); }
async function novo() { state.layout = await api('/layout').then((value) => ({ ...value, nome: 'Novo layout', elementos: [] })); state.layout.elementos.push(defaultElement('header')); state.selected = null; $('#nomeLayout').value = state.layout.nome; $('#formato').value = state.layout.formato; renderBands(); renderProperties(); status('Novo layout estruturado.'); }
async function abrir(file) { if (!file || !file.name.toLowerCase().endsWith('.fr3')) return status('Selecione um .fr3.', true); const inspected = await api('/studio/inspect', { method: 'POST', body: JSON.stringify({ conteudo_fr3: await file.text() }) }); const elementos = Array.isArray(inspected.elements) ? inspected.elements.map(importedElement) : []; if (!elementos.length) throw new Error('Nenhum componente visual com coordenadas foi encontrado.'); state.layout = { ...state.layout, nome: inspected.reportTitle || file.name.replace(/\.fr3$/i, ''), elementos }; state.selected = null; state.caminho = file.name; $('#arquivoAtual').textContent = file.name; $('#nomeLayout').value = state.layout.nome; renderBands(); renderProperties(); status(`${elementos.length} campos organizados em bandas.`); toast('Layout estruturado importado.'); }
function toggleMode() { state.modo = state.modo === 'edit' ? 'preview' : 'edit'; $('#btnModo').textContent = state.modo === 'edit' ? 'Modo: Edição' : 'Modo: Preview'; renderBands(); }
async function init() { const [layout, dataset, dictionary] = await Promise.all([api('/layout'), api('/studio/dataset'), api('/studio/dicionario')]); state.layout = layout; state.dataset = dataset; $('#nomeLayout').value = layout.nome; $('#formato').value = layout.formato; $('#dataset').textContent = JSON.stringify(dataset, null, 2); $('#dicionario').replaceChildren(...dictionary.map((value) => { const button = document.createElement('button'); button.textContent = value.exemplo; button.title = value.descricao; button.onclick = () => { const item = selected(); if (item) { item.texto = `${item.texto || ''}${value.exemplo}`; renderBands(); renderProperties(); } }; return button; })); renderLibrary(); renderBands(); }
$('#btnNovo').onclick = () => novo().catch((error) => status(error.message, true)); $('#btnAbrir').onclick = () => $('#arquivo').click(); $('#arquivo').onchange = () => abrir($('#arquivo').files[0]).catch((error) => status(error.message, true)); $('#btnSalvar').onclick = () => saveLayout().catch((error) => status(error.message, true)); $('#btnPreview').onclick = () => preview().catch((error) => status(error.message, true)); $('#btnModo').onclick = toggleMode; $('#formato').onchange = () => { state.layout.formato = $('#formato').value; }; $('#nomeLayout').oninput = () => { state.layout.nome = $('#nomeLayout').value; };
init().catch((error) => status(error.message, true));
