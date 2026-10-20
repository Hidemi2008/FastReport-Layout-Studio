// Máscaras de formatação numérica/texto no padrão pt-BR.
// Exemplos aceitos: ',0.00'  '#,0.00'  'R$ #,0.00'  '0'  '0.000'
export function formatMask(value, mask) {
  if (value === null || value === undefined || value === '') return '';
  if (!mask) return String(value);
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const m = mask.match(/^(.*?)[#,0.]+(.*)$/);
  const prefix = m ? m[1] : '';
  const suffix = m ? m[2] : '';
  const dot = mask.indexOf('.');
  const decimals = dot >= 0 ? (mask.slice(dot + 1).match(/0/g) || []).length : 0;
  const grouping = mask.includes(',');
  const txt = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouping,
  }).format(n);
  return `${prefix}${txt}${suffix}`;
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const brDate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
