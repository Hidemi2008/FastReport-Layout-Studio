# Arquitetura

```
public/ (SPA sem build) ──HTTP/JSON──▶ src/routes/api.js ──▶ services/* ──▶ SQLite
                                                              ├─ config.js    defaults, validação, merge, restaurar
                                                              ├─ dav.js       QryPrincipal / QryItens / QryNegociacao, rateio, criação
                                                              ├─ render.js    HTML A4/meia, texto térmico
                                                              ├─ fr3-parser.js metadados, SQL e sanitização
                                                              ├─ firebird.js   conexão opcional por ambiente
                                                              └─ report-service.js inspeção/execução segura
                                                              ├─ validity.js  expiração e renovação com preço vigente
                                                              ├─ audit.js     trilha de auditoria
                                                              └─ export.js    WhatsApp, PDF, e-mail
```

## Decisões

- **SQL dinâmico seguro**: ordenação, modelo de itens e rateio escolhem fragmentos de uma *lista fechada* (`ORDENACAO`, `DESC_EXPR`, `exprAjusteItem`). Nenhum valor do usuário é concatenado ao SQL; valores sempre vão por parâmetros.
- **Rateio**: `descontoAcrescimoModo` define *onde* o desconto é informado (item ou fechamento); `rateio` define *como aparece*:
  - `UNIDADE`: desconto do item é por unidade (× quantidade); o do fechamento é distribuído entre as linhas.
  - `ITEM`: desconto é o valor da linha; o fechamento é distribuído proporcionalmente ao bruto (resto no último item).
  - `FECHAMENTO`: as linhas ficam brutas e o desconto aparece só no totalizador.
  O **líquido do documento é idêntico nos três modos**; há teste garantindo a soma.
- **Kits**: o kit mestre carrega o preço; componentes (`kit_pai_item_id`) são exibidos recuados e **não entram em somas, rateio nem renovação de preço**.
- **Agrupamento**: só funde linhas "limpas" (sem desconto, acréscimo, observação e que não sejam kit), para nunca perder informação.
- **Preview**: `POST /preview` aplica o rascunho por cima da configuração gravada e **não persiste nada**.
- **Offline**: cada orçamento criado offline recebe um `client_uuid`; `POST /sync` é idempotente (reenviar não duplica).
- **XSS**: o servidor escapa todo texto no HTML impresso; o frontend usa só `textContent`; URLs de imagem são filtradas por esquema.
- **Firebird**: conexões são criadas somente por `FIREBIRD_*`; nenhum `.fr3` deve transportar host, caminho ou credenciais.
- **PascalScript**: scripts de relatório são extraídos como metadados e não executados no backend Node.js.
- **Falhas**: auditoria, abertura do banco, inspeção `.fr3` e renderização registram erros estruturados e retornam erros HTTP tratados.

## Evolução sugerida

PostgreSQL, autenticação/perfis, WhatsApp Business API, assinatura A1 de PDF, ESC/POS, cache offline de catálogo (IndexedDB + service worker).
