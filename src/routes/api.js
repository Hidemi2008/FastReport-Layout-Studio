import { Router } from 'express';
import { getConfig, saveConfig, restaurarPadroes, configComRascunho, DEFAULTS, ENUMS } from '../services/config.js';
import { criarDav, obterDavCompleto, listarDavs, atualizarObservacaoItem, TIPOS } from '../services/dav.js';
import { renderDocumentoSeguro } from '../services/render.js';
import { audit, listAudit, ACOES } from '../services/audit.js';
import { expirarVencidos, listarExpirando, recalcularPrecos } from '../services/validity.js';
import { linkWhatsapp, gerarPdf, enviarEmail } from '../services/export.js';
import { DICIONARIO_LAYOUT, listarLayouts, obterLayout, resolverLayout, salvarLayout, excluirLayout, lerFr3Arquivo, aplicarLayout, NOVO_FR3, abrirFr3, abrirFr3ComElementos, salvarFr3, validarFr3, extrairVariaveis } from '../services/layout.js';
import { obterVisualLayout, salvarVisualLayout, renderVisualLayout } from '../services/visual-layout.js';
import { inspectReport } from '../services/report-service.js';
import { parseFr3FileSafe } from '../services/fr3-parser.js';

const ctx = (req) => ({ usuario: String(req.get('x-usuario') || 'anonimo').slice(0, 60), ip: req.ip });
const wrap = (fn) => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };
const PREVIEW_DATASET = { empresa: { nome: 'Empresa de demonstração', cnpj: '00.000.000/0001-00', logo: '' }, cliente: { nome: 'Cliente de demonstração', cpf_cnpj: '000.000.000-00', telefone: '(00) 00000-0000', endereco: 'Rua de teste, 100' }, documento: { numero: 'PREVIEW-0001', tipo: 'Orçamento', data_emissao: '2026-10-19', total_liquido: 1580.5 }, itens: [{ codigo: '001', descricao: 'Produto de teste', quantidade: 2, valor_total: 1000 }, { codigo: '002', descricao: 'Serviço de teste', quantidade: 1, valor_total: 580.5 }], negociacao: [{ forma: 'PIX', valor: 1580.5 }], observacao: 'Dados exclusivamente para preview.' };

export function apiRouter(db) {
  const r = Router();

  // ---------- Config (DlgConfig) ----------
  r.get('/config', wrap((req, res) => res.json({ config: getConfig(db), defaults: DEFAULTS, enums: ENUMS })));
  r.put('/config', wrap((req, res) => res.json({ config: saveConfig(db, req.body, ctx(req)) })));
  r.post('/config/restaurar', wrap((req, res) => res.json({ config: restaurarPadroes(db, ctx(req)) })));

  // ---------- Studio de layouts .fr3 ----------
  r.get('/layouts/dicionario', (_req, res) => res.json(DICIONARIO_LAYOUT));
  r.get('/studio/dicionario', (_req, res) => res.json(DICIONARIO_LAYOUT));
  r.post('/studio/inspect', wrap((req, res) => res.json(inspectReport(req.body?.conteudo_fr3))));
  r.post('/studio/inspect-file', wrap((req, res) => res.json(parseFr3FileSafe(req.body?.caminho_arquivo, db))));
  r.get('/studio/novo', (_req, res) => res.json({ nome: 'novo-layout.fr3', conteudo_fr3: NOVO_FR3, variaveis: extrairVariaveis(NOVO_FR3) }));
  r.post('/studio/abrir', wrap((req, res) => res.json(abrirFr3ComElementos(req.body?.caminho_arquivo))));
  r.post('/studio/salvar', wrap((req, res) => res.json(salvarFr3(req.body?.caminho_arquivo, req.body?.conteudo_fr3))));
  r.post('/studio/salvar-como', wrap((req, res) => res.json(salvarFr3(req.body?.caminho_arquivo, req.body?.conteudo_fr3))));
  r.post('/studio/validar', wrap((req, res) => res.json({ valido: true, variaveis: extrairVariaveis(validarFr3(req.body?.conteudo_fr3)) })));
  r.get('/studio/dataset', (_req, res) => res.json(PREVIEW_DATASET));
  r.get('/layout', wrap((_req, res) => res.json(obterVisualLayout(db))));
  r.put('/layout', wrap((req, res) => res.json(salvarVisualLayout(db, req.body))));
  r.post('/layout/preview', wrap((req, res) => {
    const layout = req.body?.layout || obterVisualLayout(db);
    const dataset = req.body?.dataset || PREVIEW_DATASET;
    res.type('html').send(renderVisualLayout(layout, dataset));
  }));
  r.get('/layouts', wrap((req, res) => res.json(listarLayouts(db, req.query))));
  r.get('/layouts/resolver', wrap((req, res) => res.json(resolverLayout(db, {
    layoutId: req.query.layout_id, tipo: req.query.tipo, clienteId: req.query.cliente_id, filialId: req.query.filial_id,
  }))));
  r.get('/layouts/:id', wrap((req, res) => {
    const layout = obterLayout(db, Number(req.params.id));
    layout ? res.json(layout) : res.status(404).json({ erro: 'Layout não encontrado' });
  }));
  r.post('/layouts/importar-arquivo', wrap((req, res) => {
    res.json(abrirFr3ComElementos(req.body?.caminho_arquivo));
  }));
  r.post('/layouts', wrap((req, res) => res.status(201).json(salvarLayout(db, req.body, ctx(req)))));
  r.put('/layouts/:id', wrap((req, res) => res.json(salvarLayout(db, req.body, { ...ctx(req), id: Number(req.params.id) }))));
  r.delete('/layouts/:id', wrap((req, res) => { excluirLayout(db, Number(req.params.id), ctx(req).usuario); res.status(204).end(); }));
  r.post('/layouts/:id/preview', wrap((req, res) => {
    const layout = obterLayout(db, Number(req.params.id));
    if (!layout) return res.status(404).json({ erro: 'Layout não encontrado' });
    const id = Number(req.body?.dav_id);
    if (!id) return res.status(422).json({ erro: 'Informe dav_id para pré-visualizar.' });
    const cfg = getConfig(db); const dados = obterDavCompleto(db, id, cfg);
    if (!dados) return res.status(404).json({ erro: 'Documento não encontrado' });
    const xml = aplicarLayout(layout, dados);
    res.type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Preview ${layout.nome}</title>
      <style>body{font:13px monospace;margin:2rem;background:#f5f7fa;color:#14213d}pre{white-space:pre-wrap;background:white;padding:1rem;border:1px solid #cfd6e0}</style>
      <h1>${layout.nome.replace(/[<>&"]/g, '')}</h1><p>Preview do XML .fr3 com as variáveis resolvidas. A execução visual final requer o runtime FastReport.</p><pre>${xml.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre></html>`);
  }));

  // ---------- Documentos ----------
  r.get('/produtos', wrap((req, res) => res.json(db.prepare('SELECT id, codigo, descricao, unidade, preco FROM produto WHERE kit_mestre_id IS NULL ORDER BY descricao').all())));
  r.get('/clientes', wrap((req, res) => res.json(db.prepare('SELECT id, nome FROM cliente ORDER BY nome').all())));
  r.get('/tipos', (req, res) => res.json(TIPOS));
  r.get('/davs', wrap((req, res) => { expirarVencidos(db); res.json(listarDavs(db, req.query)); }));
  r.get('/davs/expirando', wrap((req, res) => res.json(listarExpirando(db, Number(req.query.dias) || 3))));
  r.post('/davs', wrap((req, res) => res.status(201).json(criarDav(db, req.body, ctx(req)))));
  r.get('/davs/:id', wrap((req, res) => {
    const d = obterDavCompleto(db, Number(req.params.id));
    d ? res.json(d) : res.status(404).json({ erro: 'Documento não encontrado' });
  }));
  r.get('/davs/:id/auditoria', wrap((req, res) => res.json(listAudit(db, Number(req.params.id)))));

  // Observação por item (DlgObservacao)
  r.patch('/davs/:id/itens/:itemId/observacao', wrap((req, res) => {
    atualizarObservacaoItem(db, Number(req.params.id), Number(req.params.itemId), req.body?.observacao, ctx(req));
    res.json({ ok: true });
  }));

  // Validade
  r.post('/davs/:id/renovar', wrap((req, res) => res.json(recalcularPrecos(db, Number(req.params.id), { ...ctx(req), recalcular: req.body?.recalcular !== false }))));

  // ---------- Modo offline: sincronização idempotente ----------
  r.post('/sync', wrap((req, res) => {
    const lote = Array.isArray(req.body?.davs) ? req.body.davs : [];
    const resultado = lote.map((p) => {
      try { return { client_uuid: p.client_uuid, ...criarDav(db, p, ctx(req)) }; }
      catch (e) { return { client_uuid: p.client_uuid, erro: e.message }; }
    });
    res.json({ resultado });
  }));

  // ---------- Preview / Impressão ----------
  // GET /davs/:id/render?modo=&formato=&imprimir=1   |  POST /davs/:id/preview  (corpo = rascunho da config, sem gravar)
  const montar = (req, rascunho) => {
    const id = Number(req.params.id);
    const cfg = configComRascunho(db, rascunho);
    if (req.query.modo) cfg.geral.modoImpressao = req.query.modo === 'termico' ? 'TERMICO' : 'GRAFICO';
    if (req.query.formato) cfg.geral.formato = String(req.query.formato).toUpperCase();
    if (!ENUMS.formato.includes(cfg.geral.formato)) throw Object.assign(new Error('Formato inválido'), { status: 422 });
    const dados = obterDavCompleto(db, id, cfg);
    if (!dados) throw Object.assign(new Error('Documento não encontrado'), { status: 404 });
    return { cfg, dados };
  };
  r.post('/davs/:id/preview', wrap((req, res) => {
    const { cfg, dados } = montar(req, req.body);
    res.type('html').send(renderDocumentoSeguro(dados, cfg, { reimpressao: dados.doc.vias_impressas > 0 }));
  }));
  r.get('/davs/:id/render', wrap((req, res) => {
    const { cfg, dados } = montar(req);
    if (req.query.layout_preview === '1' && req.query.layout_id) {
      const layout = obterLayout(db, Number(req.query.layout_id));
      if (!layout) return res.status(404).json({ erro: 'Layout não encontrado' });
      const xml = aplicarLayout(layout, dados);
      return res.type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Preview ${layout.nome}</title>
        <style>body{font:13px monospace;margin:2rem;background:#f5f7fa;color:#14213d}pre{white-space:pre-wrap;background:white;padding:1rem;border:1px solid #cfd6e0}</style>
        <h1>${layout.nome.replace(/[<>&"]/g, '')}</h1><p>Preview do XML .fr3 com variáveis resolvidas. A execução visual final requer o runtime FastReport.</p><pre>${xml.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre></html>`);
    }
    const reimp = dados.doc.vias_impressas > 0;
    if (req.query.imprimir === '1') {
      if (reimp && cfg.geral.bloquearReimpressao && req.get('x-permite-reimpressao') !== 'sim')
        return res.status(403).json({ erro: 'Reimpressão bloqueada. Requer autorização do supervisor.' });
      db.transaction(() => {
        db.prepare("UPDATE dav SET vias_impressas = vias_impressas + 1, atualizado_em = datetime('now') WHERE id = ?").run(dados.doc.id);
        audit(db, { davId: dados.doc.id, acao: reimp ? ACOES.REIMPRIMIU : ACOES.IMPRIMIU, ...ctx(req), detalhes: { formato: cfg.geral.formato, vias: cfg.geral.vias } });
      })();
    }
    res.type('html').send(renderDocumentoSeguro(dados, cfg, { reimpressao: reimp }));
  }));

  // ---------- Exportação ----------
  r.get('/davs/:id/exportar/whatsapp', wrap((req, res) => {
    const { dados } = montar(req);
    audit(db, { davId: dados.doc.id, acao: ACOES.EXPORTOU, ...ctx(req), detalhes: { canal: 'whatsapp' } });
    res.json(linkWhatsapp(dados, req.query.url || ''));
  }));
  r.get('/davs/:id/exportar/pdf', wrap(async (req, res) => {
    const { cfg, dados } = montar(req);
    const pdf = await gerarPdf(renderDocumentoSeguro(dados, cfg), { assinar: req.query.assinar === '1' });
    audit(db, { davId: dados.doc.id, acao: ACOES.EXPORTOU, ...ctx(req), detalhes: { canal: 'pdf', assinado: req.query.assinar === '1' } });
    res.type('application/pdf').send(pdf);
  }));
  r.post('/davs/:id/exportar/email', wrap(async (req, res) => {
    const { cfg, dados } = montar(req);
    await enviarEmail(dados, await gerarPdf(renderDocumentoSeguro(dados, cfg)), req.body?.para);
    audit(db, { davId: dados.doc.id, acao: ACOES.EXPORTOU, ...ctx(req), detalhes: { canal: 'email', para: req.body?.para || dados.doc.cliente_email } });
    res.json({ ok: true });
  }));

  r.use((err, req, res, _next) => {
    const status = err.status || (String(err.code || '').startsWith('SQLITE_CONSTRAINT') ? 422 : 500);
    if (status === 500) console.error(err);
    res.status(status).json({ erro: status === 500 ? 'Erro interno' : err.message, detalhes: err.detalhes });
  });
  return r;
}
