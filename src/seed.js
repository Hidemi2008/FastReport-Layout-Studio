import { openDb } from './db.js';
import { criarDav } from './services/dav.js';
import { fileURLToPath } from 'node:url';

export function seed(db) {
  db.exec(`
    INSERT INTO empresa VALUES (1,'Casa & Campo Materiais Ltda','Casa & Campo','12.345.678/0001-90','123456789','Av. Weimar Torres, 1000 – Nova Andradina/MS','(67) 3441-0000','vendas@casaecampo.com.br','Documento auxiliar de venda sem valor fiscal. Preços e disponibilidade sujeitos a confirmação.');
    INSERT INTO cliente VALUES (1,'Fazenda Boa Vista Agropecuária','98.765.432/0001-10','(67) 99999-1111','compras@boavista.com.br','Rua das Acácias, 45 – Centro','Av. Brasil, 300 – Cobrança'),
      (2,'Maria de Souza','123.456.789-09','(67) 98888-2222','maria@email.com','Rua 7 de Setembro, 12',NULL),
      (3,'Sindicato Rural (Convênio)','11.222.333/0001-44','(67) 3441-5555',NULL,'Praça Central, s/n',NULL);
    INSERT INTO propriedade VALUES (1,1,'Fazenda Boa Vista','RURAL','Rodovia MS-134, km 22 – Zona rural');
    INSERT INTO ambiente VALUES (1,'Sala'),(2,'Cozinha'),(3,'Área externa');
    INSERT INTO produto (id,codigo,codigo_barras,descricao,descricao_reduzida,marca,localizacao,ncm,unidade,preco,imagem,grade1,grade2,kit_mestre_id,eh_kit) VALUES
      (1,'1001','7891000100103','Tinta acrílica premium fosca 18L',NULL,'Suvinil','COR-A1','32091010','LT',489.90,NULL,NULL,NULL,NULL,0),
      (2,'1002','7891000100204','Cimento CP-II 50kg',NULL,'Votoran','PAT-02','25232910','SC',39.50,NULL,NULL,NULL,NULL,0),
      (3,'1003','7891000100305','Camiseta de proteção solar UV','Camiseta UV','Sol&Campo','VES-03','61091000','UN',79.90,NULL,'Azul','G',NULL,0),
      (4,'1004','7891000100406','Camiseta de proteção solar UV','Camiseta UV','Sol&Campo','VES-03','61091000','UN',79.90,NULL,'Azul','M',NULL,0),
      (5,'2000','7891000200001','Kit Pintura Completo',NULL,'Suvinil','KIT-01','32091010','KT',560.00,NULL,NULL,NULL,NULL,1),
      (6,'2001','7891000200018','Rolo de lã 23cm',NULL,'Atlas','FER-04','96034090','UN',18.00,NULL,NULL,NULL,5,0),
      (7,'2002','7891000200025','Fita crepe 48mm',NULL,'3M','FER-05','48114190','UN',9.90,NULL,NULL,NULL,5,0);
    INSERT INTO estoque VALUES (1,'LOJA',12),(1,'DEPOSITO',40),(2,'DEPOSITO',300),(3,'LOJA',8),(4,'LOJA',3),(5,'LOJA',6),(6,'LOJA',25),(7,'LOJA',60);
  `);
  const base = { caixa: 'CX01' };
  const orc = criarDav(db, { ...base, tipo: 'O', cliente_id: 1, propriedade_id: 1, parceiro_cliente_id: 3, desconto_fechamento: 50, frete: 80, itens: [
    { produto_id: 1, quantidade: 4, ambiente_id: 1, deposito: 'LOJA', situacao_entrega: 'A_ENTREGAR', observacao: 'Cor Branco Neve – conferir catálogo' },
    { produto_id: 2, quantidade: 20, deposito: 'DEPOSITO', situacao_entrega: 'A_RETIRAR' },
    { produto_id: 3, quantidade: 2, situacao_entrega: 'NA_LOJA' }, { produto_id: 3, quantidade: 1, situacao_entrega: 'NA_LOJA' },
    { produto_id: 5, quantidade: 1, ambiente_id: 2, situacao_entrega: 'NA_LOJA' },
    { produto_id: 6, quantidade: 2, kit_pai_seq: 5 }, { produto_id: 7, quantidade: 3, kit_pai_seq: 5 },
  ] }, { usuario: 'seed' });
  criarDav(db, { ...base, tipo: 'P', cliente_id: 2, itens: [{ produto_id: 4, quantidade: 2 }],
    negociacao: [{ finalizador: 'CARTAO', parcela: 1, vencimento: '2026-11-19', valor: 159.80 }] }, { usuario: 'seed' });
  criarDav(db, { ...base, tipo: 'C', cliente_id: 2, itens: [{ produto_id: 3, quantidade: 3 }, { produto_id: 4, quantidade: 3 }] }, { usuario: 'seed' });
  return orc.id;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { const db = openDb(); seed(db); console.log('Seed concluído.'); }
