// Auditoria: quem gerou, alterou, reimprimiu, exportou ou convertou um DAV.
export const ACOES = Object.freeze({
  CRIOU: 'CRIOU', ALTEROU: 'ALTEROU', IMPRIMIU: 'IMPRIMIU', REIMPRIMIU: 'REIMPRIMIU',
  EXPORTOU: 'EXPORTOU', OBS_ITEM: 'OBS_ITEM', RECALCULOU: 'RECALCULOU', EXPIROU: 'EXPIROU', CONFIG: 'CONFIG',
  REPORT_ERROR: 'REPORT_ERROR',
});

export function audit(db, { davId = null, acao, usuario = 'sistema', detalhes = null, ip = null }) {
  try {
    if (!acao) throw new Error('Ação de auditoria obrigatória.');
    db.prepare('INSERT INTO audit_log (dav_id, acao, usuario, detalhes, ip) VALUES (?,?,?,?,?)')
      .run(davId, acao, String(usuario || 'sistema').slice(0, 60), detalhes ? JSON.stringify(detalhes) : null, ip);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'audit_write_failed', action: acao, davId, error: error.message }));
    throw new Error('Não foi possível registrar a auditoria.', { cause: error });
  }
}

export function listAudit(db, davId) {
  try {
    return db.prepare('SELECT * FROM audit_log WHERE dav_id = ? ORDER BY id DESC').all(davId)
      .map((r) => ({ ...r, detalhes: r.detalhes ? JSON.parse(r.detalhes) : null }));
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'audit_read_failed', davId, error: error.message }));
    throw new Error('Não foi possível ler a auditoria.', { cause: error });
  }
}
