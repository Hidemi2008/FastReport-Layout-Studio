import { formatMask } from './format.js';

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Link wa.me com mensagem pronta (abre o WhatsApp Web/App do operador; não envia sozinho).
// Para envio automático use a WhatsApp Business Cloud API (ver docs/ARQUITETURA.md).
export function linkWhatsapp({ doc, empresa }, urlPublica = '') {
  let fone = soDigitos(doc.cliente_telefone);
  if (fone && fone.length <= 11) fone = `55${fone}`;
  const msg = `Olá, ${doc.cliente_nome || ''}! Segue o ${doc.tipo_info.nome.toLowerCase()} nº ${doc.numero} da ${empresa.fantasia || empresa.razao_social || 'nossa loja'}, ` +
    `no valor de ${formatMask(doc.total_liquido, 'R$ #,0.00')}.${doc.data_validade ? ` Válido até ${doc.data_validade.split('-').reverse().join('/')}.` : ''}${urlPublica ? ` ${urlPublica}` : ''}`;
  return { telefone: fone, mensagem: msg, url: `https://wa.me/${fone}?text=${encodeURIComponent(msg)}` };
}

// PDF via puppeteer (dependência opcional). Assinatura digital: gancho para PFX (ICP-Brasil) – requer lib de assinatura.
export async function gerarPdf(html, { assinar = false } = {}) {
  let puppeteer;
  try { puppeteer = (await import('puppeteer')).default; } catch {
    throw Object.assign(new Error('PDF indisponível: instale a dependência opcional "puppeteer".'), { status: 501 });
  }
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    if (assinar) {
      if (!process.env.PDF_SIGN_PFX) throw Object.assign(new Error('Assinatura digital não configurada (PDF_SIGN_PFX).'), { status: 501 });
      // Ponto de extensão: assine `pdf` com @signpdf/signpdf + certificado A1 (.pfx) e retorne o Buffer assinado.
      throw Object.assign(new Error('Assinatura digital: implemente o provedor em services/export.js (ver docs).'), { status: 501 });
    }
    return pdf;
  } finally { await browser.close(); }
}

export async function enviarEmail({ doc, empresa }, pdfBuffer, para) {
  let nodemailer;
  try { nodemailer = (await import('nodemailer')).default; } catch {
    throw Object.assign(new Error('E-mail indisponível: instale a dependência opcional "nodemailer".'), { status: 501 });
  }
  if (!process.env.SMTP_HOST) throw Object.assign(new Error('SMTP não configurado (.env).'), { status: 501 });
  const tr = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined });
  await tr.sendMail({ from: process.env.SMTP_FROM, to: para || doc.cliente_email, subject: `${doc.tipo_info.nome} nº ${doc.numero} – ${empresa.fantasia || ''}`,
    text: `Segue em anexo o ${doc.tipo_info.nome.toLowerCase()} nº ${doc.numero}.`, attachments: [{ filename: `${doc.numero}.pdf`, content: pdfBuffer }] });
}
