import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { audit, ACOES } from './audit.js';

const MAX_FR3 = 5 * 1024 * 1024;
const SECRET_ATTR = /\b(?:user|username|password|passwd|pwd|login|database|databasename|connectionstring|connection)\s*=\s*(['"])[\s\S]*?\1/gi;
const SECRET_TAG = /(<(?:Database|Connection|TfrxDBDataSet|TfrxIBXDatabase|TfrxIBDatabase)\b[^>]*>)[\s\S]*?(<\/(?:Database|Connection|TfrxDBDataSet|TfrxIBXDatabase|TfrxIBDatabase)>)/gi;
const LEGACY_DATABASE = /\b(?:\d{1,3}(?:\.\d{1,3}){3}:)?(?:[A-Za-z]:[\\/]|[\\/])[^<>"\r\n]*\.(?:ib|fdb|gdb)\b/gi;
const CREDENTIAL_ATTR = /\b(?:UserName|User|Login|Password|Passwd|Pwd)\s*=\s*(['"])([\s\S]*?)\1/gi;
const SQL_NAME = /\b(?:QryPrincipal|QryItens|QryNegociacao|Qry[A-Za-z0-9_]+)\b/i;
const SQL_ATTR = /\b(?:SQL|SQLText|CommandText|Text)\s*=\s*(['"])([\s\S]*?)\1/gi;
const SQL_TAG = /<(?:SQL|SQLText|CommandText)\b[^>]*>([\s\S]*?)<\/(?:SQL|SQLText|CommandText)>/gi;
const VISUAL_TAG = /^Tfrx(?:MemoView|RichView|PictureView|LineView|ShapeView|Subreport)|^MemoView$/i;
const CONTAINER_TAG = /^Tfrx(?:ReportPage|Page|DataBand|Header|Footer|ReportTitle|PageHeader|PageFooter|GroupHeader|GroupFooter|ColumnHeader|ColumnFooter|Child|Overlay|ReportSummary|PageSummary|MasterData|DetailData|SubdetailData)\b|^(?:ReportPage|Page|DataBand|Header|Footer|ReportTitle|PageHeader|PageFooter)$/i;

const decodeXml = (v) => String(v)
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function failure(message, status = 422, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.status = status;
  return error;
}

export function neutralizeConnectionData(xml) {
  let sanitized = String(xml).replace(SECRET_ATTR, (match, quote) => {
    const key = match.slice(0, match.indexOf('=')).trim().toLowerCase();
    const variable = key.includes('database') ? 'FIREBIRD_DATABASE' : key.includes('connection') ? 'FIREBIRD_CONNECTION' : key.includes('password') || key.includes('passwd') || key.includes('pwd') ? 'FIREBIRD_PASSWORD' : 'FIREBIRD_USER';
    return match.replace(new RegExp(`${quote}[\\s\\S]*${quote}$`), `${quote}\${${variable}}${quote}`);
  });
  sanitized = sanitized.replace(SECRET_TAG, '$1${FIREBIRD_ENV}$2');
  sanitized = sanitized.replace(LEGACY_DATABASE, '${FIREBIRD_DATABASE}');
  sanitized = sanitized.replace(CREDENTIAL_ATTR, (match, quote, value) => {
    if (!/^(?:SYSDBA|RELATORIO)$/i.test(value.trim())) return match;
    const variable = /password|passwd|pwd/i.test(match) ? 'FIREBIRD_PASSWORD' : 'FIREBIRD_USER';
    return match.replace(`${quote}${value}${quote}`, `${quote}\${${variable}}${quote}`);
  });
  return sanitized;
}

export function resolveConnectionData(xml, env = process.env) {
  return String(xml)
    .replace(/\$\{FIREBIRD_DATABASE\}/g, env.FIREBIRD_DATABASE || '')
    .replace(/\$\{FIREBIRD_CONNECTION\}/g, env.FIREBIRD_CONNECTION || '')
    .replace(/\$\{FIREBIRD_USER\}/g, env.FIREBIRD_USER || '')
    .replace(/\$\{FIREBIRD_PASSWORD\}/g, env.FIREBIRD_PASSWORD || '')
    .replace(/\$\{FIREBIRD_ENV\}/g, env.FIREBIRD_USER || '');
}

export function normalizeFirebirdSql(sql) {
  return decodeXml(sql).replace(/\r\n?/g, '\n').trim();
}

function tolerantText(value) {
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  return String(value ?? '').replace(/\u0000/g, '').replace(/\uFFFD/g, '');
}

function attributes(tag) {
  const values = {};
  for (const match of tag.matchAll(/([A-Za-z][\w.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    values[match[1].toLowerCase()] = decodeXml(match[3] ?? match[4] ?? '');
  }
  return values;
}

function numberAttribute(attrs, name, fallback = 0) {
  const raw = attrs[name.toLowerCase()];
  if (raw == null || raw === '') return fallback;
  const value = Number(String(raw).replace(',', '.'));
  return Number.isFinite(value) ? value : fallback;
}

function normalizeVisualElement(tagName, attrs, index, innerText = '', offset = { x: 0, y: 0 }) {
  if (!VISUAL_TAG.test(tagName)) return null;
  if (/^(?:0|false|hidden)$/i.test(attrs.visibility || attrs.visible || '')) return null;
  const hasGeometry = ['left', 'top', 'width', 'height'].some((key) => attrs[key] != null);
  if (!hasGeometry) return null;
  // FastReport VCL serializes TfrxView coordinates in screen pixels (96 DPI).
  // PaperWidth/PaperHeight are millimeters, but Left/Top/Width/Height are not.
  const scale = 1;
  const type = /picture/i.test(tagName) ? 'logo'
    : /(?:databand|header|groupheader)/i.test(tagName) ? 'itens'
      : /(?:footer|groupfooter|pagefooter)/i.test(tagName) ? 'rodape'
        : /(?:line|shape)/i.test(tagName) ? 'texto' : 'texto';
  const rawText = attrs.text || attrs.datafield || innerText || attrs.name || tagName;
  const fontName = attrs['font.name'] || attrs.fontname || 'Arial';
  const fontHeight = Math.max(8, Math.round(Math.abs(numberAttribute(attrs, 'font.height', 14)) * 72 / 96));
  const left = Math.max(0, Math.round((offset.x + numberAttribute(attrs, 'left')) * scale));
  const top = Math.max(0, Math.round((offset.y + numberAttribute(attrs, 'top')) * scale));
  const width = Math.max(20, Math.round(numberAttribute(attrs, 'width', 40) * scale));
  const height = Math.max(12, Math.round(numberAttribute(attrs, 'height', 12) * scale));
  return {
    id: `fr3-${index}-${String(attrs.name || tagName).replace(/[^A-Za-z0-9_-]+/g, '-').toLowerCase()}`,
    tipo: type,
    titulo: attrs.name || tagName,
    texto: decodeXml(rawText).replace(/&#xA;|&#10;/gi, '\n'),
    x: left, y: top, largura: width, altura: height,
    estilo: {
      fontFamily: fontName,
      fontSize: fontHeight,
      fontWeight: /(?:1|bold)/i.test(attrs['font.style'] || '') ? '700' : '400',
      textAlign: /center/i.test(attrs.halign || '') ? 'center' : /right/i.test(attrs.halign || '') ? 'right' : 'left',
      color: '#14213d', background: 'transparent', borderColor: '#cfd6e0',
      borderWidth: numberAttribute(attrs, 'frame.typ', 0) ? 1 : 0, padding: 2,
    },
    origem: { tag: tagName, nome: attrs.name || null, dataset: attrs.datasetname || attrs.dataset || null },
  };
}

function extractVisualElements(source) {
  const elements = [];
  const token = /<\s*(\/?)\s*(Tfrx[A-Za-z0-9_]+|MemoView|DataBand|ReportTitle|PageHeader|PageFooter|Header|Footer|Page|ReportPage)\b([^>]*?)(\/?)\s*>/gi;
  const stack = [];
  for (const match of source.matchAll(token)) {
    const closing = Boolean(match[1]);
    const tagName = match[2];
    if (closing) {
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].tagName.toLowerCase() === tagName.toLowerCase()) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const attrs = attributes(match[0]);
    const parentOffset = stack.at(-1)?.offset || { x: 0, y: 0 };
    const ownOffset = {
      x: parentOffset.x + (CONTAINER_TAG.test(tagName) ? numberAttribute(attrs, 'left') : 0),
      y: parentOffset.y + (CONTAINER_TAG.test(tagName) ? numberAttribute(attrs, 'top') : 0),
    };
    const element = normalizeVisualElement(tagName, attrs, elements.length, '', parentOffset);
    if (element) elements.push(element);
    if (!match[4] && CONTAINER_TAG.test(tagName)) stack.push({ tagName, offset: ownOffset });
  }
  return elements;
}

function extractTags(source, name) {
  return [...source.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi'))].map((m) => decodeXml(m[1]).trim()).filter(Boolean);
}

export function extractFr3Metadata(xml) {
  const source = tolerantText(xml);
  if (!source.trim()) throw failure('O conteúdo do .fr3 está vazio.');
  if (Buffer.byteLength(source, 'utf8') > MAX_FR3) throw failure('O arquivo .fr3 excede o limite de 5 MB.');
  const warnings = [];
  if (!/<\s*TfrxReport\b/i.test(source)) warnings.push('Tag TfrxReport não encontrada; o arquivo pode ser texto legado ou estar truncado.');
  if (!/<\/\s*TfrxReport\s*>/i.test(source)) warnings.push('Fechamento TfrxReport ausente; inspeção realizada em modo tolerante.');
  if (/\b(?:PropData|ScriptText)\b/i.test(source)) warnings.push('PropData/ScriptText detectado; blocos binários e PascalScript não foram executados.');
  const queries = [];
  for (const match of source.matchAll(SQL_ATTR)) {
    const sql = normalizeFirebirdSql(match[2]);
    if (sql && (SQL_NAME.test(sql) || /\b(?:select|execute\s+block|with)\b/i.test(sql))) queries.push(sql);
  }
  for (const match of source.matchAll(SQL_TAG)) {
    const sql = normalizeFirebirdSql(match[1]);
    if (sql && (SQL_NAME.test(sql) || /\b(?:select|execute\s+block|with)\b/i.test(sql))) queries.push(sql);
  }
  const datasetNames = [...new Set([...source.matchAll(/\b(?:Name|UserName|AliasName)\s*=\s*"([^"]+)"/gi)].map((m) => m[1]).filter((name) => /^Qry/i.test(name)))];
  const components = [...new Set([...source.matchAll(/<(Tfrx[A-Za-z0-9_]+|ReportPage|Page)\b/gi)].map((m) => m[1]))];
  const scripts = extractTags(source, 'ScriptText');
  const reportTitle = source.match(/<ReportTitle[^>]*>([\s\S]*?)<\/ReportTitle>/i)?.[1]?.trim()
    || source.match(/<TfrxReport\b[^>]*\b(?:Name|ReportOptions\.Name|Description)\s*=\s*(['"])(.*?)\1/i)?.[2]
    || null;
  const elements = extractVisualElements(source);
  return {
    reportTitle: reportTitle ? decodeXml(reportTitle) : null,
    datasetNames,
    components,
    elements,
    queries: [...new Set(queries)],
    scripts: scripts.map((text) => ({ length: text.length, preview: text.slice(0, 500), executable: false })),
    hasPascalScript: scripts.length > 0,
    tolerant: warnings.length > 0,
    warnings,
    sanitizedXml: neutralizeConnectionData(source),
  };
}

export function parseFr3File(filePath) {
  if (typeof filePath !== 'string' || extname(filePath).toLowerCase() !== '.fr3') throw failure('O caminho deve apontar para um arquivo .fr3.');
  try {
    const raw = readFileSync(filePath);
    return { filePath, ...extractFr3Metadata(raw) };
  } catch (error) {
    if (error.status) throw error;
    throw failure(`Falha ao ler o arquivo .fr3: ${error.message}`, 422, error);
  }
}

export function normalizeFr3Layout(metadata, filePath = null) {
  return {
    nome: metadata.reportTitle || (filePath ? String(filePath).split(/[\\/]/).pop().replace(/\.fr3$/i, '') : 'Layout importado'),
    arquivo: filePath,
    formato: 'A4',
    componentes: metadata.components,
    elementos: metadata.elements || [],
    datasets: metadata.datasetNames,
    consultas: metadata.queries,
    scripts: metadata.scripts,
    avisos: metadata.warnings,
    sanitizado: metadata.sanitizedXml,
  };
}

export function parseFr3FileSafe(filePath, db, context = {}) {
  try {
    const parsed = parseFr3File(filePath);
    return { ok: true, ...parsed, layout: normalizeFr3Layout(parsed, filePath) };
  } catch (error) {
    const details = { operation: 'parse_fr3', filePath: String(filePath || ''), message: error.message, ...context };
    try { if (db) audit(db, { acao: ACOES.REPORT_ERROR, detalhes: details }); } catch (auditError) {
      console.error(JSON.stringify({ level: 'error', event: 'fr3_parse_audit_failed', error: auditError.message }));
    }
    return {
      ok: false,
      filePath,
      reportTitle: null,
      datasetNames: [],
      queries: [],
      scripts: [],
      hasPascalScript: false,
      tolerant: true,
      warnings: [error.message],
      sanitizedXml: '',
      error: 'Não foi possível ler o arquivo .fr3. O layout padrão foi mantido.',
      layout: normalizeFr3Layout({ reportTitle: null, components: [], elements: [], datasetNames: [], queries: [], scripts: [], warnings: [error.message], sanitizedXml: '' }, filePath),
    };
  }
}
