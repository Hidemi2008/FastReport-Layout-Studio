PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS empresa (
  id INTEGER PRIMARY KEY, razao_social TEXT NOT NULL, fantasia TEXT, cnpj TEXT, ie TEXT,
  endereco TEXT, telefone TEXT, email TEXT, rodape_legal TEXT
);

CREATE TABLE IF NOT EXISTS cliente (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, documento TEXT, telefone TEXT, email TEXT,
  endereco_cadastro TEXT, endereco_cobranca TEXT
);

CREATE TABLE IF NOT EXISTS propriedade (
  id INTEGER PRIMARY KEY, cliente_id INTEGER REFERENCES cliente(id), nome TEXT, tipo TEXT CHECK (tipo IN ('RURAL','COMERCIAL')), endereco TEXT
);

CREATE TABLE IF NOT EXISTS ambiente (id INTEGER PRIMARY KEY, nome TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS produto (
  id INTEGER PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, codigo_barras TEXT, descricao TEXT NOT NULL,
  descricao_reduzida TEXT, marca TEXT, localizacao TEXT, ncm TEXT, unidade TEXT DEFAULT 'UN',
  preco REAL NOT NULL DEFAULT 0, imagem TEXT,
  grade1 TEXT, grade2 TEXT,                       -- ex.: cor / tamanho
  kit_mestre_id INTEGER REFERENCES produto(id),   -- componente aponta para o kit mestre
  eh_kit INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS estoque (
  produto_id INTEGER NOT NULL REFERENCES produto(id), deposito TEXT NOT NULL, quantidade REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (produto_id, deposito)
);

CREATE TABLE IF NOT EXISTS dav (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_uuid TEXT UNIQUE,                         -- idempotência do modo offline
  tipo TEXT NOT NULL CHECK (tipo IN ('C','O','P')),-- C=Condicional O=Orçamento P=Pedido
  numero TEXT, caixa TEXT,
  cliente_id INTEGER REFERENCES cliente(id),
  convenio_cliente_id INTEGER REFERENCES cliente(id),
  parceiro_cliente_id INTEGER REFERENCES cliente(id),
  propriedade_id INTEGER REFERENCES propriedade(id),
  endereco_venda TEXT,
  data_emissao TEXT NOT NULL DEFAULT (date('now')),
  data_validade TEXT,
  status TEXT NOT NULL DEFAULT 'ABERTO' CHECK (status IN ('ABERTO','EXPIRADO','CONVERTIDO','CANCELADO')),
  frete REAL NOT NULL DEFAULT 0,
  desconto_fechamento REAL NOT NULL DEFAULT 0,
  acrescimo_fechamento REAL NOT NULL DEFAULT 0,
  observacao TEXT,
  vias_impressas INTEGER NOT NULL DEFAULT 0,
  criado_por TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS dav_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dav_id INTEGER NOT NULL REFERENCES dav(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  produto_id INTEGER NOT NULL REFERENCES produto(id),
  quantidade REAL NOT NULL,
  valor_unitario REAL NOT NULL,
  desconto REAL NOT NULL DEFAULT 0,                -- interpretado conforme config (UNIDADE | ITEM)
  acrescimo REAL NOT NULL DEFAULT 0,
  ambiente_id INTEGER REFERENCES ambiente(id),
  deposito TEXT,
  situacao_entrega TEXT NOT NULL DEFAULT 'NA_LOJA' CHECK (situacao_entrega IN ('NA_LOJA','A_ENTREGAR','A_RETIRAR','NO_CLIENTE')),
  kit_pai_item_id INTEGER REFERENCES dav_item(id),
  observacao TEXT CHECK (observacao IS NULL OR length(observacao) <= 150)
);
CREATE INDEX IF NOT EXISTS ix_dav_item_dav ON dav_item(dav_id);

CREATE TABLE IF NOT EXISTS dav_negociacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dav_id INTEGER NOT NULL REFERENCES dav(id) ON DELETE CASCADE,
  finalizador TEXT NOT NULL CHECK (finalizador IN ('DINHEIRO','CARTAO','CREDIARIO','BOLETO','TROCO')),
  parcela INTEGER NOT NULL DEFAULT 1,
  vencimento TEXT,
  valor REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_dav_neg_dav ON dav_negociacao(dav_id);

CREATE TABLE IF NOT EXISTS config_dav (
  empresa_id INTEGER NOT NULL DEFAULT 1, chave TEXT NOT NULL, valor TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (empresa_id, chave)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, dav_id INTEGER, acao TEXT NOT NULL, usuario TEXT NOT NULL,
  detalhes TEXT, ip TEXT, em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_dav ON audit_log(dav_id);

CREATE TABLE IF NOT EXISTS layout_template (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo_documento TEXT NOT NULL CHECK (tipo_documento IN ('C','O','P','TODOS')),
  filial_id INTEGER NOT NULL DEFAULT 1,
  cliente_id INTEGER REFERENCES cliente(id) ON DELETE SET NULL,
  caminho_arquivo TEXT,
  conteudo_fr3 TEXT NOT NULL,
  variaveis TEXT NOT NULL DEFAULT '[]',
  padrao INTEGER NOT NULL DEFAULT 0 CHECK (padrao IN (0,1)),
  criado_por TEXT NOT NULL DEFAULT 'sistema',
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_layout_resolucao
  ON layout_template (filial_id, tipo_documento, cliente_id, padrao);

CREATE TABLE IF NOT EXISTS visual_layout (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nome TEXT NOT NULL DEFAULT 'Studio Layout',
  formato TEXT NOT NULL DEFAULT 'A4',
  estrutura_json TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
