import { audit, ACOES } from './audit.js';
import { getConfig } from './config.js';

const hoje = () => new Date().toISOString().slice(0, 10);

// Marca como EXPIRADO os documentos O/C vencidos. Chamar no boot e em intervalo (ver server.js).
export function expirarVencidos(db, { usuario = 'sistema', hojeISO = hoje() } = {}) {
  const ids = db.prepare("SELECT id FROM dav WHERE status = 'ABERTO' AND tipo IN ('O','C') AND data_validade IS NOT NULL AND data_validade < ?").all(hojeISO);
  db.transaction(() => {
    for (const { id } of ids) {
      db.prepare("UPDATE dav SET status = 'EXPIRADO', atualizado_em = datetime('now') WHERE id = ?").run(id);
      audit(db, { davId: id, acao: ACOES.EXPIROU, usuario, detalhes: { hojeISO } });
    }
  })();
  return ids.map((r) => r.id);
}

export function listarExpirando(db, dias = 3, hojeISO = hoje()) {
  const limite = new Date(`${hojeISO}T12:00:00`); limite.setDate(limite.getDate() + dias);
  return db.prepare(`SELECT d.id, d.numero, d.tipo, d.data_validade, c.nome AS cliente_nome
    FROM dav d LEFT JOIN cliente c ON c.id = d.cliente_id
    WHERE d.status = 'ABERTO' AND d.tipo IN ('O','C') AND d.data_validade BETWEEN ? AND ? ORDER BY d.data_validade`)
    .all(hojeISO, limite.toISOString().slice(0, 10));
}

// Reabre/renova o documento atualizando preços para a tabela vigente (produto.preco).
export function recalcularPrecos(db, davId, { usuario = 'sistema', ip = null, hojeISO = hoje(), recalcular = true } = {}) {
  const d = db.prepare('SELECT id, status, tipo FROM dav WHERE id = ?').get(davId);
  if (!d) throw Object.assign(new Error('Documento não encontrado'), { status: 404 });
  if (['CONVERTIDO', 'CANCELADO'].includes(d.status)) throw Object.assign(new Error(`Documento ${d.status} não pode ser renovado`), { status: 409 });
  const dias = getConfig(db).geral.validadeDias;
  const mudancas = [];
  db.transaction(() => {
    if (recalcular) {
      const itens = db.prepare('SELECT i.id, i.valor_unitario AS antigo, p.preco AS novo FROM dav_item i JOIN produto p ON p.id = i.produto_id WHERE i.dav_id = ? AND i.kit_pai_item_id IS NULL').all(davId);
      for (const it of itens) if (it.antigo !== it.novo) { db.prepare('UPDATE dav_item SET valor_unitario = ? WHERE id = ?').run(it.novo, it.id); mudancas.push(it); }
    }
    const nova = new Date(`${hojeISO}T12:00:00`); nova.setDate(nova.getDate() + dias);
    db.prepare("UPDATE dav SET status = 'ABERTO', data_validade = ?, atualizado_em = datetime('now') WHERE id = ?").run(nova.toISOString().slice(0, 10), davId);
    audit(db, { davId, acao: ACOES.RECALCULOU, usuario, ip, detalhes: { recalcular, itensAlterados: mudancas } });
  })();
  return { itensAlterados: mudancas.length, mudancas };
}
