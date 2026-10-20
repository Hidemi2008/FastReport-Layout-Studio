const REQUIRED = ['FIREBIRD_HOST', 'FIREBIRD_DATABASE', 'FIREBIRD_USER', 'FIREBIRD_PASSWORD'];

function configFromEnv(env = process.env) {
  return {
    host: env.FIREBIRD_HOST || '127.0.0.1',
    port: Number(env.FIREBIRD_PORT || 3050),
    database: env.FIREBIRD_DATABASE,
    user: env.FIREBIRD_USER,
    password: env.FIREBIRD_PASSWORD,
    lowercase_keys: true,
    role: env.FIREBIRD_ROLE || undefined,
    pageSize: Number(env.FIREBIRD_PAGE_SIZE || 4096),
  };
}

export function getFirebirdConfig(env = process.env) {
  const cfg = configFromEnv(env);
  if (!env.FIREBIRD_DATABASE) return { enabled: false, config: cfg, missing: REQUIRED.filter((key) => !env[key]) };
  if (!cfg.user || !cfg.password) {
    const error = new Error(`Configuração Firebird incompleta. Variáveis ausentes: ${REQUIRED.filter((key) => !env[key]).join(', ')}`);
    error.status = 500;
    throw error;
  }
  return { enabled: true, config: cfg, missing: [] };
}

export async function createFirebirdClient({ env = process.env, driver } = {}) {
  const info = getFirebirdConfig(env);
  if (!info.enabled) return null;
  let firebird = driver;
  if (!firebird) {
    try { firebird = await import('node-firebird'); } catch (error) {
      const e = new Error('O driver node-firebird não está instalado.', { cause: error }); e.status = 503; throw e;
    }
  }
  firebird = firebird.default || firebird;
  return {
    async query(sql, params = []) {
      if (typeof sql !== 'string' || !sql.trim()) { const e = new Error('SQL vazio.'); e.status = 422; throw e; }
      return new Promise((resolve, reject) => {
        firebird.attach(info.config, (attachError, db) => {
          if (attachError) return reject(new Error('Falha ao conectar ao Firebird.', { cause: attachError }));
          db.query(sql, params, (queryError, rows) => {
            db.detach(() => {});
            if (queryError) return reject(new Error('Falha ao executar consulta Firebird.', { cause: queryError }));
            resolve(rows || []);
          });
        });
      });
    },
  };
}
