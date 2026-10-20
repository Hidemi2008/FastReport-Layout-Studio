import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { extname } from 'node:path';
import { neutralizeConnectionData, parseFr3File } from './fr3-parser.js';

const MAX_FR3 = 5 * 1024 * 1024;
const XML_ENTITY = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const LAYOUT_TIPOS = ['C', 'O', 'P', 'TODOS'];
export const DICIONARIO_LAYOUT = Object.freeze([
  { chave: 'Cliente.Nome', exemplo: '[Cliente.Nome]', descricao: 'Nome ou razão social do cliente' },
  { chave: 'Cliente.CPF_CNPJ', exemplo: '[Cliente.CPF_CNPJ]', descricao: 'CPF/CNPJ do cliente' },
  { chave: 'Cliente.Telefone', exemplo: '[Cliente.Telefone]', descricao: 'Telefone do cliente' },
  { chave: 'Cliente.Endereco', exemplo: '[Cliente.Endereco]', descricao: 'Endereço de entrega/cadastro' },
  { chave: 'Empresa.Nome', exemplo: '[Empresa.Nome]', descricao: 'Nome fantasia ou razão social' },
  { chave: 'Empresa.Logo', exemplo: '[Empresa.Logo]', descricao: 'URL ou imagem da empresa' },
  { chave: 'Documento.Numero', exemplo: '[Documento.Numero]', descricao: 'Número do DAV' },
  { chave: 'Documento.Tipo', exemplo: '[Documento.Tipo]', descricao: 'Tipo do documento' },
  { chave: 'Documento.DataEmissao', exemplo: '[Documento.DataEmissao]', descricao: 'Data de emissão' },
  { chave: 'Documento.TotalLiquido', exemplo: '[Documento.TotalLiquido]', descricao: 'Total líquido' },
  { chave: 'Item.Codigo', exemplo: '[Item.Codigo]', descricao: 'Código do item' },
  { chave: 'Item.Descricao', exemplo: '[Item.Descricao]', descricao: 'Descrição do item' },
  { chave: 'Item.Quantidade', exemplo: '[Item.Quantidade]', descricao: 'Quantidade do item' },
  { chave: 'Item.ValorTotal', exemplo: '[Item.ValorTotal]', descricao: 'Total do item' },
]);

function erro(msg, status = 422) {
  const e = new Error(msg); e.status = status; return e;
}

export function validarFr3(conteudo) {
  if (typeof conteudo !== 'string' || !conteudo.trim()) throw erro('O conteúdo do .fr3 não pode ser vazio.');
  if (Buffer.byteLength(conteudo, 'utf8') > MAX_FR3) throw erro('O arquivo .fr3 excede o limite de 5 MB.');
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<[^>]+>[\s\S]*<\/[^>]+>\s*$/i.test(conteudo))
    throw erro('Arquivo .fr3 inválido: XML incompleto ou corrompido.');
  const pilha = [];
  for (const token of conteudo.matchAll(/<\s*(\/?)\s*([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?(\/?)\s*>/g)) {
    if (token[2].startsWith('?') || token[2].startsWith('!') || token[3] === '/') continue;
    if (token[1]) {
      if (pilha.pop() !== token[2]) throw erro('Arquivo .fr3 inválido: tags XML desencontradas.');
    } else pilha.push(token[2]);
  }
  if (pilha.length) throw erro('Arquivo .fr3 inválido: tags XML não fechadas.');
  return neutralizeConnectionData(conteudo);
}

export function extrairVariaveis(conteudo) {
  return [...new Set([...String(conteudo).matchAll(/\[([A-Za-z][A-Za-z0-9_.]*)\]/g)].map((m) => m[1]))].sort();
}

export function lerFr3Arquivo(caminho) {
  if (typeof caminho !== 'string' || extname(caminho).toLowerCase() !== '.fr3') throw erro('O caminho deve apontar para um arquivo .fr3.');
  try {
    const conteudo = readFileSync(caminho, 'utf8').replace(/\u0000/g, '');
    if (!conteudo.trim()) throw erro('O arquivo .fr3 está vazio.');
    if (Buffer.byteLength(conteudo, 'utf8') > MAX_FR3) throw erro('O arquivo .fr3 excede o limite de 5 MB.');
    return conteudo;
  }
  catch (e) { if (e.status) throw e; throw erro(`Não foi possível carregar o arquivo .fr3: ${e.message}`, 422); }
}

function row(r) {
  return r ? { ...r, variaveis: JSON.parse(r.variaveis || '[]'), padrao: !!r.padrao } : null;
}

export function listarLayouts(db, { tipo, cliente_id: clienteId, filial_id: filialId = 1 } = {}) {
  const args = [Number(filialId) || 1]; let where = 'filial_id = ?';
  if (tipo && LAYOUT_TIPOS.includes(String(tipo))) { where += ' AND (tipo_documento = ? OR tipo_documento = ?)'; args.push(tipo, 'TODOS'); }
  if (clienteId) { where += ' AND (cliente_id IS NULL OR cliente_id = ?)'; args.push(Number(clienteId)); }
  return db.prepare(`SELECT id,nome,tipo_documento,filial_id,cliente_id,caminho_arquivo,variaveis,padrao,criado_por,criado_em,atualizado_em
    FROM layout_template WHERE ${where} ORDER BY padrao DESC, nome`).all(...args).map(row);
}

export function obterLayout(db, id) {
  return row(db.prepare('SELECT * FROM layout_template WHERE id = ?').get(Number(id)));
}

export function resolverLayout(db, { layoutId, tipo = 'O', clienteId, filialId = 1 } = {}) {
  if (layoutId) return obterLayout(db, layoutId);
  const r = db.prepare(`SELECT * FROM layout_template
    WHERE filial_id = ? AND (tipo_documento = ? OR tipo_documento = 'TODOS')
      AND (cliente_id IS NULL OR cliente_id = ?)
    ORDER BY (cliente_id IS NOT NULL) DESC, padrao DESC, id DESC LIMIT 1`).get(Number(filialId) || 1, tipo, clienteId || 0);
  return row(r);
}

export function salvarLayout(db, input, { id, usuario = 'sistema', filialId = 1 } = {}) {
  const nome = String(input?.nome || '').trim();
  const tipo = String(input?.tipo_documento || 'TODOS').toUpperCase();
  if (!nome || nome.length > 120) throw erro('Informe um nome de layout com até 120 caracteres.');
  if (!LAYOUT_TIPOS.includes(tipo)) throw erro('Tipo de documento inválido.');
  const conteudo = neutralizeConnectionData(validarFr3(input?.conteudo_fr3));
  const variaveis = extrairVariaveis(conteudo);
  const clienteId = input?.cliente_id ? Number(input.cliente_id) : null;
  const caminho = input?.caminho_arquivo ? String(input.caminho_arquivo) : null;
  let saved;
  db.transaction(() => {
    if (input?.padrao) db.prepare('UPDATE layout_template SET padrao = 0 WHERE filial_id = ? AND tipo_documento = ? AND (cliente_id IS ? OR cliente_id = ?)').run(filialId, tipo, clienteId, clienteId);
    if (id) {
      if (!obterLayout(db, id)) throw erro('Layout não encontrado.', 404);
      db.prepare(`UPDATE layout_template SET nome=?,tipo_documento=?,filial_id=?,cliente_id=?,caminho_arquivo=?,conteudo_fr3=?,variaveis=?,padrao=?,atualizado_em=datetime('now') WHERE id=?`)
        .run(nome, tipo, filialId, clienteId, caminho, conteudo, JSON.stringify(variaveis), input.padrao ? 1 : 0, id);
    } else {
      const r = db.prepare(`INSERT INTO layout_template (nome,tipo_documento,filial_id,cliente_id,caminho_arquivo,conteudo_fr3,variaveis,padrao,criado_por)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(nome, tipo, filialId, clienteId, caminho, conteudo, JSON.stringify(variaveis), input.padrao ? 1 : 0, usuario);
      id = r.lastInsertRowid;
    }
    saved = obterLayout(db, id);
  })();
  return saved;
}

export function excluirLayout(db, id, usuario = 'sistema') {
  if (!obterLayout(db, id)) throw erro('Layout não encontrado.', 404);
  db.prepare('DELETE FROM layout_template WHERE id = ?').run(Number(id));
}

function valor(data, chave) {
  const aliases = { 'Cliente.Nome': data.doc.cliente_nome, 'Cliente.CPF_CNPJ': data.doc.cliente_documento, 'Cliente.Telefone': data.doc.cliente_telefone,
    'Cliente.Endereco': data.doc.endereco_entrega, 'Empresa.Nome': data.empresa.fantasia || data.empresa.razao_social, 'Empresa.Logo': data.empresa.logo,
    'Documento.Numero': data.doc.numero, 'Documento.Tipo': data.doc.tipo_info?.nome, 'Documento.DataEmissao': data.doc.data_emissao,
    'Documento.TotalLiquido': data.doc.total_liquido };
  return aliases[chave] ?? '';
}

export function aplicarLayout(layout, data) {
  if (!layout) return null;
  const item = data.itens?.[0] || {};
  const valores = { ...Object.fromEntries(DICIONARIO_LAYOUT.map((v) => [v.chave, valor(data, v.chave)])),
    'Item.Codigo': item.codigo, 'Item.Descricao': item.descricao, 'Item.Quantidade': item.quantidade, 'Item.ValorTotal': item.valor_total };
  return layout.conteudo_fr3.replace(/\[([A-Za-z][A-Za-z0-9_.]*)\]/g, (_, key) => XML_ENTITY(valores[key] ?? `[${key}]`));
}

export const MAX_LAYOUT_BYTES = MAX_FR3;

export const NOVO_FR3 = `<?xml version="1.0" encoding="utf-8"?>
<TfrxReport Version="6.0">
  <ReportTitle>Studio Layout</ReportTitle>
  <MemoView>[Empresa.Nome]</MemoView>
  <MemoView>[Documento.Tipo] Nº [Documento.Numero]</MemoView>
</TfrxReport>
`;

export function abrirFr3(caminho) {
  return lerFr3Arquivo(caminho);
}

export function abrirFr3ComElementos(caminho) {
  const parsed = parseFr3File(caminho);
  return {
    caminho_arquivo: caminho,
    conteudo_fr3: parsed.sanitizedXml,
    elementos: parsed.elements,
    componentes: parsed.components,
    metadados: parsed,
    variaveis: extrairVariaveis(parsed.sanitizedXml),
  };
}

export function salvarFr3(caminho, conteudo) {
  if (typeof caminho !== 'string' || extname(caminho).toLowerCase() !== '.fr3') throw erro('O caminho deve apontar para um arquivo .fr3.');
  const validado = neutralizeConnectionData(validarFr3(conteudo));
  try {
    mkdirSync(dirname(caminho), { recursive: true });
    writeFileSync(caminho, validado, 'utf8');
  } catch (e) {
    throw erro(`Não foi possível salvar o arquivo .fr3: ${e.message}`, 422);
  }
  return { caminho_arquivo: caminho, variaveis: extrairVariaveis(validado), bytes: Buffer.byteLength(validado, 'utf8') };
}
