import { parseFr3File, extractFr3Metadata } from './fr3-parser.js';

export function inspectReport(source, { file = false } = {}) {
  try { return file ? parseFr3File(source) : extractFr3Metadata(source); }
  catch (error) {
    error.reportOperation = 'inspect';
    throw error;
  }
}

export function executeReportQuery(client, sql, params = []) {
  return client.query(sql, params).catch((error) => {
    const wrapped = new Error(`Não foi possível executar a consulta do relatório: ${error.message}`, { cause: error });
    wrapped.status = error.status || 502;
    throw wrapped;
  });
}
