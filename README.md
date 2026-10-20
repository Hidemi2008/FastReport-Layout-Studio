# FastReport Layout Studio

Aplicação mono-usuário para criação, edição, validação e preview de arquivos `.fr3`.
O dataset de DAV permanece somente como massa fictícia para testes visuais.

## Integração segura com relatórios Ganso/Firebird

Serviços dedicados:

- `src/services/fr3-parser.js`: valida XML, extrai título, datasets, consultas SQL e metadados de PascalScript sem executar código.
- `src/services/firebird.js`: adaptador opcional `node-firebird`, configurado exclusivamente por variáveis de ambiente.
- `src/services/report-service.js`: fachada para inspeção e execução de consultas com erros contextualizados.
- `src/services/render.js`: `renderDocumentoSeguro` transforma falhas de renderização em erros tratados.

Endpoints de diagnóstico:

- `POST /api/studio/inspect` — recebe `conteudo_fr3` e retorna metadados.
- `POST /api/studio/inspect-file` — lê e analisa um `.fr3` local no servidor.

### Configuração Firebird

Copie `.env.example` para `.env` e preencha somente no ambiente correspondente:

```ini
FIREBIRD_HOST=127.0.0.1
FIREBIRD_PORT=3050
FIREBIRD_DATABASE=/dados/ganso/Ganso.IB
FIREBIRD_USER=RELATORIO
FIREBIRD_PASSWORD=senha-fora-do-repositorio
FIREBIRD_ROLE=
```

O arquivo `.fr3` não deve conter conexão ou credenciais. O parser neutraliza atributos de conexão e substitui valores por `${FIREBIRD_ENV}` antes de qualquer processamento auxiliar. PascalScript embutido é identificado e exibido apenas como metadado; por segurança, não é executado por Node.js.

Consultas Firebird, incluindo `execute block`, são preservadas pelo normalizador. A aplicação não tenta converter o dialeto para SQLite nem interpolar parâmetros; o driver recebe SQL e parâmetros separadamente.

### Layouts Ganso disponíveis

Os arquivos legados `PADRÃO vendas.fr3` e `EtiquetaKit4 V2.fr3`, quando presentes na raiz do módulo, são testados diretamente por `tests/layout.test.js`. A importação tolerante aceita seus blocos `PropData`, componentes `Tfrx*`, páginas, consultas SQL e `ScriptText` sem executar PascalScript. Em caso de arquivo ausente, truncado ou ilegível, `parseFr3FileSafe()` retorna uma representação normalizada com avisos e registra `REPORT_ERROR` na auditoria.

## Rodando

```bash
npm install
npm start            # http://localhost:3000  (cria data/dav.db e popula dados de exemplo no 1º uso)
npm test             # 18 testes (cálculo, rateio, kits, config, render, API)
```

Opcionais (não instalados por padrão, pois o puppeteer baixa um Chromium):

```bash
npm i puppeteer      # habilita exportação em PDF
npm i nodemailer     # habilita envio por e-mail (configure SMTP_* no .env)
```

Copie `.env.example` para `.env` e ajuste. Variáveis: `PORT`, `DB_FILE`, `SMTP_*`, `PDF_SIGN_*`.

## O que está implementado

| Requisito | Onde |
|---|---|
| Dataset fictício para preview | `GET /api/studio/dataset` |
| Modo gráfico A4 / meia página, marca d'água, vias, reimpressão | `services/render.js` (`renderGrafico*`) |
| Modo térmico 58/80 mm, delimitadores `() [] {} \|\| <>` | `services/render.js` (`renderTermico`) |
| Studio de arquivos `.fr3` | `public/app.js`, `services/layout.js` |
| Rateio por Unidade / Item / Fechamento | `services/dav.js` (`qryPrincipal`, `calcularItens`) |
| Prioridade de endereço de entrega | `services/dav.js` (`resolverEndereco`) |
| `QryPrincipal`, `QryItens` (simples, grade, agrupado/kits), `QryNegociacao` | `services/dav.js` |
| Observação por item (150 caracteres) | `PATCH /api/davs/:id/itens/:itemId/observacao`, `abrirObservacao` |
| Preview em tempo real sem gravar | `POST /api/davs/:id/preview` |
| Gravar / Cancelar / Restaurar padrões com controle de estado | `abrirConfig` |
| Validade com expiração automática e recálculo opcional de preços | `services/validity.js` |
| Exportação: WhatsApp, PDF, e-mail | `services/export.js` |
| Studio de layouts `.fr3`, dicionário de variáveis e associação por tipo/cliente | `services/layout.js`, `GET/POST /api/layouts` |
| Modo offline com sincronização idempotente | `POST /api/sync` (`client_uuid`), fila em `public/app.js` |

## Limitações conhecidas (leia antes de ir para produção)

- **Assinatura digital de PDF** está como ponto de extensão (retorna 501). Falta integrar um assinador com certificado A1 (`@signpdf/signpdf`).
- **WhatsApp** gera o link `wa.me` com a mensagem pronta; o envio automático exige a WhatsApp Business Cloud API.
- **Offline** cobre *criação* de orçamentos (fila local + sincronização idempotente). Edição offline de documentos existentes e cache completo de catálogo não estão incluídos.
- **Autenticação**: o operador vem do header `x-usuario` (informativo). Em produção, use login/JWT e valide a permissão de reimpressão no servidor.
- Banco SQLite por simplicidade; o SQL é quase padrão e portável para PostgreSQL com ajustes (`AUTOINCREMENT`, `datetime('now')`).
- A impressão térmica gera texto monoespaçado. Para ESC/POS direto na impressora, use a saída de `renderTermico` como base.
- Esta base é Node.js/web; o `TfrxDesigner` nativo (Delphi/FastReport) não pode ser embarcado sem uma aplicação Delphi e o runtime FastReport. O Studio atual oferece edição XML, validação, abertura via seletor local, gravação por caminho no backend e preview do XML/dataset.
- Não há login, perfis, autorização ou auditoria de usuário na interface do Studio.
