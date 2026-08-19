import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import type { RawRule } from "../src/ast-walker.js";
import { extractRulesFromFunction } from "../src/ast-walker.js";
import { extrairPosicoesDaCondicao, mapToDsl } from "../src/rule-mapper.js";

const fixture = readFileSync(
  new URL("./fixtures/sample-condicoes.js", import.meta.url),
  "utf-8"
);

describe("mapToDsl", () => {
  it("classifica todos os arquetipos", () => {
    const raw = extractRulesFromFunction(fixture, "amostra");
    const rules = raw.map((r) => mapToDsl(r, "cobranca-remessa"));
    assert.strictEqual(rules[0].condicao.tipo, "literal_fixo");
    assert.strictEqual(rules[1].condicao.tipo, "numerico_branco");
    assert.strictEqual(rules[2].condicao.tipo, "dominio");
    assert.strictEqual(rules[3].condicao.tipo, "modulo_11");
    assert.strictEqual(rules[4].condicao.tipo, "coerencia_registro");
  });

  it("resolve a variável da guarda no ponto em que a guarda foi aberta", () => {
    // O fonte reusa `sm` dentro do bloco que a guarda abre: o segundo dígito
    // sobrescreve a soma do primeiro. Resolver `dv1` com a ordem da regra pegaria
    // a soma do segundo dígito — dez parcelas onde o primeiro tem nove —, e o
    // motor conferiria o dígito informado contra um cálculo que o fonte não faz.
    const codigo = `
      function digitos(res) {
        var str = "";
        if (res[0].substring(17, 18) == 1) {
          sm = res[0].substring(21, 22) * 10 + res[0].substring(22, 23) * 9;
          resto1 = sm;
          resto1 %= 11;
          dv1 = 11 - resto1;
          if (resto1 == 0) dv1 = 0;
          if (res[0].substring(30, 31) == dv1) {
            sm = res[0].substring(21, 22) * 11 + res[0].substring(22, 23) * 10 + res[0].substring(30, 31) * 2;
            resto2 = sm;
            resto2 %= 11;
            dv2 = 11 - resto2;
            if (res[0].substring(31, 32) != dv2) {
              str += "Linha 1, coluna 032, Header de arquivo, segundo dígito inválido.<br>";
            }
          }
        }
        return str;
      }
    `;
    const raw = extractRulesFromFunction(codigo, "digitos");
    const regra = mapToDsl(raw[0], "multipag");

    const dv1 = (regra.variaveis_guarda ?? []).find((v) => v.nome === "dv1");
    assert.ok(dv1, "a guarda cita dv1; sem ele a regra não é avaliável");
    assert.strictEqual(dv1.tipo, "modulo_11");
    assert.deepStrictEqual(dv1.base.map((p) => p.peso), [10, 9]);
    assert.strictEqual(dv1.modulo, 11);

    // A condição continua sendo a do segundo dígito, com a soma dele.
    assert.strictEqual(regra.condicao.tipo, "modulo_11");
    if (regra.condicao.tipo === "modulo_11") {
      assert.deepStrictEqual(regra.condicao.base.map((p) => p.peso), [11, 10, 2]);
    }
  });

  it("não publica variável de guarda que não sabe calcular", () => {
    // `sm` vem de uma soma de variáveis intermediárias (é como o fonte escreve o
    // módulo 10 do código de barras), que nenhum arquétipo modela. Publicar um
    // cálculo parcial faria o runner decidir a guarda com um resto inventado.
    const codigo = `
      function luhn(res) {
        var str = "";
        if (res[0].substring(13, 14) == "O") {
          sm10 = soma1 + soma2 + soma3;
          resto10 = sm10;
          resto10 %= 10;
          if (resto10 == 0) {
            if (res[0].substring(20, 21) != "0") {
              str += "Linha 1, coluna 021, Segmento O, dígito verificador inválido.<br>";
            }
          }
        }
        return str;
      }
    `;
    const raw = extractRulesFromFunction(codigo, "luhn");
    const regra = mapToDsl(raw[0], "multipag");
    assert.strictEqual(
      (regra.variaveis_guarda ?? []).find((v) => v.nome === "resto10"),
      undefined
    );
  });

  it("cai em custom quando nenhum arquetipo bate", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 999,
      condicao_original: 'res[0].substring(1, 3) == funcaoEstranha(res[0])',
      mensagem: "Condicao custom invalida.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "custom");
    assert.strictEqual(dsl.condicao.alvo, "res[0]");
  });

  it("nao classifica cadeia de literais fixos com posicoes diferentes como dominio", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 998,
      condicao_original:
        'res[0].substring(1, 3) != "AB" && res[0].substring(4, 6) != "CD"',
      mensagem: "Cadeia de literais invalida.",
      registro: null,
      colunas: [1, 6],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    // Duas faixas distintas não são um domínio; a conjunção descreve o que o
    // fonte testa sem fundir os valores numa lista só.
    assert.strictEqual(dsl.condicao.tipo, "conjuncao");
    if (dsl.condicao.tipo === "conjuncao") {
      assert.deepStrictEqual(
        dsl.condicao.partes.map((p) => p.tipo),
        ["literal_fixo", "literal_fixo"]
      );
    }
  });

  it("nao classifica modulo_11 sem o ambiente que define o digito", () => {
    // A condição sozinha é `faixa != variavel`: sem saber como a variável foi
    // calculada, publicar `modulo_11` seria afirmar um algoritmo que o extrator
    // não viu.
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 997,
      condicao_original: "res[0].substring(13, 14) != dv1",
      mensagem: "Modulo 11 invalido.",
      registro: null,
      colunas: [13, 14],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "custom");
  });

  it("trata regra de comprimento de linha como arquétipo próprio, sem posição", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 996,
      condicao_original: "res[0].length != 240",
      mensagem: "Mensagem de teste colunas 5 a 10.",
      registro: null,
      colunas: null,
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "tamanho_linha");
    assert.deepStrictEqual(dsl.colunas, [0, 0]);
    assert.deepStrictEqual(dsl.posicoes, []);
  });

  it("extrai colunas da condicao em vez da mensagem", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 996,
      condicao_original: 'res[0].substring(10, 15) != "XXXXX"',
      mensagem: "Mensagem com colunas 5 a 10.",
      registro: null,
      colunas: [5, 10],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.deepStrictEqual(dsl.colunas, [11, 15]);
    assert.strictEqual(dsl.posicoes[0].inicio0, 10);
    assert.strictEqual(dsl.posicoes[0].fim0, 15);
    assert.strictEqual(dsl.posicoes[0].tamanho, 5);
  });

  it("corrige colunas invertidas e emite aviso", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 996,
      condicao_original: 'res[0].substring(15, 10) != "XXXXX"',
      mensagem: "Mensagem com colunas invertidas.",
      registro: null,
      colunas: [16, 10],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.posicoes[0].inicio0, 10);
    assert.strictEqual(dsl.posicoes[0].fim0, 15);
    assert.strictEqual(dsl.posicoes[0].tamanho, 5);
  });

  it("gera id no formato layout:funcao:linha", () => {
    const raw: RawRule = {
      funcao_origem: "validarDadosArquivo240",
      linha_fonte: 42,
      condicao_original: 'res[0].substring(1, 3) != "XX"',
      mensagem: "Teste.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.id, "cobranca-remessa:validarDadosArquivo240:42");
  });

  it("extrai posicoes da condicao", () => {
    assert.deepStrictEqual(extrairPosicoesDaCondicao('res[0].substring(5, 9) != "X"'), {
      inicio0: 5,
      fim0: 9,
    });
    assert.strictEqual(extrairPosicoesDaCondicao("res[0].length != 240"), null);
  });

  it("classifica dominio com && sem espacos", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 995,
      condicao_original:
        'res[0].substring(1,3)!="A"&&res[0].substring(1,3)!="B"',
      mensagem: "Dominio sem espacos.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "dominio");
    assert.deepStrictEqual((dsl.condicao as any).valores, ["A", "B"]);
  });

  it("classifica dominio com espacos extras em torno de &&", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 994,
      condicao_original:
        'res[0].substring(1, 3) != "A"   &&   res[0].substring(1, 3) != "B"',
      mensagem: "Dominio com espacos extras.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "dominio");
    assert.deepStrictEqual((dsl.condicao as any).valores, ["A", "B"]);
  });

  it("classifica dominio com clausulas entre parenteses", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 993,
      condicao_original:
        '(res[0].substring(1, 3) != "A") && (res[0].substring(1, 3) != "B")',
      mensagem: "Dominio com parenteses.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "dominio");
    assert.deepStrictEqual((dsl.condicao as any).valores, ["A", "B"]);
  });

  it("classifica literal_fixo com !==", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 992,
      condicao_original: 'res[0].substring(1, 3) !== "XX"',
      mensagem: "Literal fixo com !==.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "literal_fixo");
    // `!==` e `!=` colapsam no mesmo operador; o que os distingue — haver ou não
    // coerção de tipo — vive em `comparacao`.
    assert.strictEqual((dsl.condicao as any).operador, "!=");
    assert.strictEqual((dsl.condicao as any).comparacao, "estrita");
  });

  it("classifica literal_fixo entre parenteses externos", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 991,
      condicao_original: '(res[0].substring(1, 3) !== "XX")',
      mensagem: "Literal fixo entre parenteses.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "literal_fixo");
    // `!==` e `!=` colapsam no mesmo operador; o que os distingue — haver ou não
    // coerção de tipo — vive em `comparacao`.
    assert.strictEqual((dsl.condicao as any).operador, "!=");
    assert.strictEqual((dsl.condicao as any).comparacao, "estrita");
    assert.strictEqual((dsl.condicao as any).valor, "XX");
  });

  it("classifica literal_fixo com literal numerico", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 990,
      condicao_original: "res[0].substring(1, 3) != 0",
      mensagem: "Literal numerico invalido.",
      registro: null,
      colunas: [1, 3],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "literal_fixo");
    assert.strictEqual((dsl.condicao as any).valor, "0");
  });

  it("funde cadeia de ifs aninhados sobre a mesma posição em dominio", () => {
    // O fonte encadeia um `if` por valor e só o nível mais interno emite a mensagem;
    // a condição própria isolada é uma desigualdade só, a cadeia inteira é o domínio.
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 336,
      condicao_original:
        '(res[0].substring(70, 71) != "P") && (res[0].substring(70, 71) != "0") && (res[0].substring(70, 71) != "1")',
      condicao_guarda:
        '(res[0].substring(70, 71) != "P") && (res[0].substring(70, 71) != "0")',
      condicao_propria: 'res[0].substring(70, 71) != "1"',
      mensagem: "Linha 1, coluna 071, Header de arquivo, valor inválido.",
      registro: "header-arquivo",
      colunas: [71, 71],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "dominio");
    assert.deepStrictEqual(
      dsl.condicao.tipo === "dominio" ? dsl.condicao.valores : [],
      ["P", "0", "1"]
    );
    assert.deepStrictEqual(dsl.colunas, [71, 71]);
  });

  it("não funde quando a guarda testa outra posição", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 400,
      condicao_original:
        '(res[i].substring(13, 14) == "P") && (res[i].substring(15, 17) != "01")',
      condicao_guarda: '(res[i].substring(13, 14) == "P")',
      condicao_propria: 'res[i].substring(15, 17) != "01"',
      mensagem: "Linha , colunas 016 a 017, código inválido.",
      registro: "segmento-p",
      colunas: [16, 17],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "literal_fixo");
    assert.deepStrictEqual(dsl.colunas, [16, 17]);
  });

  it("classifica coerencia entre linhas distintas", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 500,
      condicao_original:
        '(res[i].substring(7, 8) == 1) && (res[i].substring(18, 32) != res[0].substring(18, 32))',
      condicao_guarda: "(res[i].substring(7, 8) == 1)",
      condicao_propria: "res[i].substring(18, 32) != res[0].substring(18, 32)",
      mensagem: "Header de lote, colunas 019 a 032, CNPJ divergente do Header de arquivo.",
      registro: "header-lote",
      registro_referenciado: "header-arquivo",
      colunas: [19, 32],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "coerencia_registro");
    if (dsl.condicao.tipo === "coerencia_registro") {
      assert.strictEqual(dsl.condicao.alvo, "res[i]");
      assert.strictEqual(dsl.condicao.outro, "res[0]");
      assert.deepStrictEqual(dsl.condicao.posicao, { inicio0: 18, fim0: 32 });
    }
    assert.strictEqual(dsl.registro_referenciado, "header-arquivo");
  });
  it("publica o deslocamento que o fonte soma ao outro lado da coerencia", () => {
    // Sequencial de detalhe: o fonte não compara as duas leituras, compara uma
    // com a outra menos um. Sem o deslocamento a regra vira `custom` — e foi
    // assim que o corpus ficou com trailers errados sem ninguém notar.
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 700,
      condicao_original:
        "(res[i].substring(7, 8) == 3 && res[j].substring(7, 8) == 3) && (res[i].substring(8, 13) != res[j].substring(8, 13) - 1)",
      condicao_guarda: "(res[i].substring(7, 8) == 3 && res[j].substring(7, 8) == 3)",
      condicao_propria: "res[i].substring(8, 13) != res[j].substring(8, 13) - 1",
      mensagem: "Linha {linha}, colunas 009 a 013, sequencial de registro fora de sequencia.",
      registro: "detalhe",
      colunas: [9, 13],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "coerencia_registro");
    if (dsl.condicao.tipo === "coerencia_registro") {
      assert.strictEqual(dsl.condicao.ajuste, null);
      assert.strictEqual(dsl.condicao.ajuste_outro, -1);
      assert.strictEqual(dsl.condicao.outro, "res[j]");
    }
  });

  it("publica o deslocamento quando ele esta do lado do alvo", () => {
    // Quantidade de registros do lote: o trailer conta header e trailer, o
    // sequencial do último detalhe não. O `- 2` fica à esquerda, e um matcher
    // que só olhasse a direita perderia a regra.
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 710,
      condicao_original:
        "(res[i].substring(7, 8) == 5) && (res[i].substring(17, 23) - 2 != res[i - 1].substring(8, 13))",
      condicao_guarda: "(res[i].substring(7, 8) == 5)",
      condicao_propria: "res[i].substring(17, 23) - 2 != res[i - 1].substring(8, 13)",
      mensagem: "Linha {linha}, Trailer de lote, colunas 018 a 023, quantidade divergente.",
      registro: "trailer-lote",
      colunas: [18, 23],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "coerencia_registro");
    if (dsl.condicao.tipo === "coerencia_registro") {
      assert.strictEqual(dsl.condicao.ajuste, -2);
      assert.strictEqual(dsl.condicao.ajuste_outro, null);
      assert.deepStrictEqual(dsl.condicao.posicao, { inicio0: 17, fim0: 23 });
      assert.deepStrictEqual(dsl.condicao.posicao_outro, { inicio0: 8, fim0: 13 });
    }
  });

  it("coerencia sem deslocamento continua sem ajuste", () => {
    // O campo existe em toda regra de coerência, e `null` é o que diz ao motor
    // para comparar texto com texto, sem passar pela coerção numérica.
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 720,
      condicao_original: "res[i].substring(0, 3) != res[i - 1].substring(0, 3)",
      condicao_guarda: null,
      condicao_propria: "res[i].substring(0, 3) != res[i - 1].substring(0, 3)",
      mensagem: "Linha {linha}, colunas 001 a 003, Número do banco diferente no mesmo lote.",
      registro: "detalhe",
      colunas: [1, 3],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "coerencia_registro");
    if (dsl.condicao.tipo === "coerencia_registro") {
      assert.strictEqual(dsl.condicao.ajuste, null);
      assert.strictEqual(dsl.condicao.ajuste_outro, null);
    }
  });

  it("funde cadeia negada com literal numerico e marca comparacao frouxa", () => {
    // Forma do fonte: um `if` por valor, negando a igualdade contra literal sem
    // aspas. Sem aspas o JavaScript coage os tipos — um campo em branco vale zero.
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 600,
      condicao_original:
        "(res[i].substring(7, 8) == 1) && (!(res[i].substring(9, 11) == 01)) && (!(res[i].substring(9, 11) == 03)) && (!(res[i].substring(9, 11) == 90))",
      condicao_guarda:
        "(res[i].substring(7, 8) == 1) && (!(res[i].substring(9, 11) == 01)) && (!(res[i].substring(9, 11) == 03))",
      condicao_propria: "!(res[i].substring(9, 11) == 90)",
      mensagem: "Linha {linha}, colunas 010 a 011, tipo de serviço inválido.",
      registro: "header-lote",
      colunas: [10, 11],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "dominio");
    if (dsl.condicao.tipo === "dominio") {
      assert.deepStrictEqual(dsl.condicao.valores, ["01", "03", "90"]);
      assert.strictEqual(dsl.condicao.sentido, "permitidos");
      assert.strictEqual(dsl.condicao.comparacao, "frouxa");
      assert.deepStrictEqual(dsl.condicao.posicao, { inicio0: 9, fim0: 11 });
    }
    // A guarda de tipo de registro não é do domínio e continua publicada à parte.
    assert.deepStrictEqual(dsl.colunas, [10, 11]);
  });

  it("nao funde cadeia quando a clausula extra nao esta na guarda", () => {
    // Descartar uma cláusula que o `if` testa e a guarda não registra faria a regra
    // disparar onde o fonte não dispara.
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 601,
      condicao_original:
        'res[i].substring(20, 22) == "10" && res[i].substring(9, 11) != "01" && res[i].substring(9, 11) != "03"',
      condicao_guarda: null,
      condicao_propria:
        'res[i].substring(20, 22) == "10" && res[i].substring(9, 11) != "01" && res[i].substring(9, 11) != "03"',
      mensagem: "Linha {linha}, colunas 010 a 011, valor inválido.",
      registro: "header-lote",
      colunas: [10, 11],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.notStrictEqual(dsl.condicao.tipo, "dominio");
    assert.strictEqual(dsl.condicao.tipo, "conjuncao");
  });

  it("classifica dominio proibido escrito como disjuncao de igualdades", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 602,
      condicao_original:
        'res[0].substring(11, 13) == "07" || res[0].substring(11, 13) == "08" || res[0].substring(11, 13) == "09"',
      mensagem: "Linha 1, colunas 012 a 013, valor não aceito.",
      registro: "header-arquivo",
      colunas: [12, 13],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "dominio");
    if (dsl.condicao.tipo === "dominio") {
      assert.strictEqual(dsl.condicao.sentido, "proibidos");
      assert.deepStrictEqual(dsl.condicao.valores, ["07", "08", "09"]);
      assert.strictEqual(dsl.condicao.comparacao, "estrita");
    }
  });

  it("nao classifica dominio proibido quando as faixas diferem", () => {
    // Data quebrada em pedaços: cada cláusula lê um campo diferente, então a lista
    // de valores não é o domínio de uma posição.
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 603,
      condicao_original:
        "res[0].substring(143, 145) == 00 || res[0].substring(145, 147) == 00",
      mensagem: "Linha 1, colunas 144 a 151, data inválida.",
      registro: "header-arquivo",
      colunas: [144, 151],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.notStrictEqual(dsl.condicao.tipo, "dominio");
  });

  it("distingue o que cada variante de numerico_branco exige", () => {
    const casos: [string, string][] = [
      ["res[0].substring(7, 11).replace(/\\s/g, '').length == 0", "numerico_preenchido"],
      ["res[0].substring(7, 11).replace(/\\s/g, '').length != 0", "branco"],
      ["res[0].substring(7, 11).replace(/\\d/g, '').length == 1", "numerico"],
    ];
    for (const [residuo, exige] of casos) {
      const raw: RawRule = {
        funcao_origem: "amostra",
        linha_fonte: 604,
        condicao_original: `isNaN(res[0].substring(7, 11)) || ${residuo}`,
        mensagem: "Linha 1, colunas 008 a 011, campo inválido.",
        registro: "header-arquivo",
        colunas: [8, 11],
        alvo: "res[0]",
      };
      const dsl = mapToDsl(raw, "cobranca-remessa");
      assert.strictEqual(dsl.condicao.tipo, "numerico_branco", residuo);
      if (dsl.condicao.tipo === "numerico_branco") {
        assert.strictEqual(dsl.condicao.exige, exige, residuo);
        assert.deepStrictEqual(dsl.condicao.posicao, { inicio0: 7, fim0: 11 });
      }
    }
  });

  it("nao encaixa residuo desconhecido em numerico_branco", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 605,
      condicao_original:
        "isNaN(res[0].substring(7, 11)) || res[0].substring(7, 11).replace(/\\d/g, '').length == 4",
      mensagem: "Linha 1, colunas 008 a 011, campo inválido.",
      registro: "header-arquivo",
      colunas: [8, 11],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "custom");
  });

  it("nao casa numerico_branco quando as duas metades leem faixas diferentes", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 606,
      condicao_original:
        "isNaN(res[0].substring(7, 11)) || res[0].substring(12, 15).replace(/\\s/g, '').length == 0",
      mensagem: "Linha 1, campo inválido.",
      registro: "header-arquivo",
      colunas: [8, 11],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.notStrictEqual(dsl.condicao.tipo, "numerico_branco");
  });

  it("classifica disjuncao de blocos e publica todas as faixas lidas", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 607,
      condicao_original:
        "isNaN(res[0].substring(52, 57)) || res[0].substring(52, 57).replace(/\\d/g, '').length == 1 || isNaN(res[0].substring(58, 70)) || res[0].substring(58, 70).replace(/\\s/g, '').length == 0",
      mensagem: "Linha 1, colunas 053 a 070, agência/conta não é numérico.",
      registro: "header-arquivo",
      colunas: [53, 70],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "disjuncao");
    if (dsl.condicao.tipo === "disjuncao") {
      assert.deepStrictEqual(
        dsl.condicao.partes.map((p) => p.tipo),
        ["numerico_branco", "numerico_branco"]
      );
    }
    assert.deepStrictEqual(
      dsl.posicoes.map((p) => p.colunas),
      [
        [53, 57],
        [59, 70],
      ]
    );
    // `colunas` da regra é o envelope das faixas que a disjunção lê.
    assert.deepStrictEqual(dsl.colunas, [53, 70]);
  });

  it("disjuncao com parte nao modelada continua custom", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 608,
      condicao_original:
        'res[0].substring(7, 11) == "0000" || funcaoEstranha(res[0]) > 3',
      mensagem: "Linha 1, campo inválido.",
      registro: "header-arquivo",
      colunas: [8, 11],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "custom");
  });
  it("classifica modulo_11 a partir do ambiente do fonte", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 700,
      condicao_original:
        '(res[0].substring(57, 58) == "P") && (res[0].substring(57, 58) != dva)',
      condicao_guarda: '(res[0].substring(57, 58) == "P")',
      condicao_propria: "res[0].substring(57, 58) != dva",
      mensagem: "Linha 1, colunas 058 a 058, Dígito da agência inválido.",
      registro: "header-arquivo",
      colunas: [58, 58],
      alvo: "res[0]",
      ambiente: {
        sm: [
          {
            operador: "=",
            expressao:
              "res[0].substring(53, 54) * 5 + res[0].substring(54, 55) * 4 + res[0].substring(55, 56) * 3 + res[0].substring(56, 57) * 2",
            quando: null,
            ordem: 1,
          },
        ],
        restoa: [
          { operador: "=", expressao: "sm", quando: null, ordem: 2 },
          { operador: "%=", expressao: "11", quando: null, ordem: 3 },
        ],
        dva: [
          { operador: "=", expressao: "0", quando: "(restoa == 0)", ordem: 4 },
          { operador: "=", expressao: '"P"', quando: "(restoa == 1)", ordem: 5 },
          { operador: "=", expressao: "11 - restoa", quando: "(restoa > 1)", ordem: 6 },
        ],
      },
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "modulo_11");
    if (dsl.condicao.tipo !== "modulo_11") return;

    assert.strictEqual(dsl.condicao.modulo, 11);
    assert.strictEqual(dsl.condicao.variavel, "dva");
    assert.strictEqual(dsl.condicao.documento, "agencia");
    assert.deepStrictEqual(
      dsl.condicao.base.map((b) => [b.inicio0, b.fim0, b.peso]),
      [
        [53, 54, 5],
        [54, 55, 4],
        [55, 56, 3],
        [56, 57, 2],
      ]
    );
    // Neste ramo — o arquivo informou `P` — o resto 1 espera `P`, não zero. É a
    // bifurcação que faz o validador aceitar os dois no resto 1.
    assert.deepStrictEqual(
      dsl.condicao.resultado.map((r) => [r.operador, r.resto, r.valor, r.expressao]),
      [
        ["==", 0, "0", "0"],
        ["==", 1, "P", '"P"'],
        [">", 1, null, "11 - resto"],
      ]
    );
    assert.deepStrictEqual(dsl.colunas, [58, 58]);
  });

  it("aceita valor padrão incondicional no calculo do digito", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 701,
      condicao_original: "obterValorCNPJAlfanumerico(res[0].substring(30, 31)) != dv1",
      mensagem: "Linha 1, colunas 019 a 033, número de inscrição/CNPJ inválido.",
      registro: "header-arquivo",
      colunas: [19, 33],
      alvo: "res[0]",
      ambiente: {
        sm: [
          {
            operador: "=",
            expressao:
              "obterValorCNPJAlfanumerico(res[0].substring(18, 19)) * 5 + obterValorCNPJAlfanumerico(res[0].substring(19, 20)) * 4",
            quando: null,
            ordem: 1,
          },
        ],
        resto1: [
          { operador: "=", expressao: "sm", quando: null, ordem: 2 },
          { operador: "%=", expressao: "11", quando: null, ordem: 3 },
        ],
        dv1: [
          { operador: "=", expressao: "11 - resto1", quando: null, ordem: 4 },
          { operador: "=", expressao: "0", quando: "(resto1 == 0)", ordem: 5 },
        ],
      },
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "modulo_11");
    if (dsl.condicao.tipo !== "modulo_11") return;

    assert.strictEqual(dsl.condicao.transformacao, "obterValorCNPJAlfanumerico");
    assert.strictEqual(dsl.condicao.base[0].transformacao, "obterValorCNPJAlfanumerico");
    // A atribuição sem guarda é o padrão, e vem primeiro: a ordem do fonte é a
    // ordem de avaliação, e a última que casa vence.
    assert.deepStrictEqual(
      dsl.condicao.resultado.map((r) => [r.operador, r.resto]),
      [
        [null, null],
        ["==", 0],
      ]
    );
  });

  it("classifica intervalo de caixa baixa como faixa sobre a mesma posicao", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 702,
      condicao_original:
        "res[0].substring(70, 71) >= 'a' && res[0].substring(70, 71) <= 'z'",
      mensagem: "Linha 1, colunas 071 a 071, informar em letra maiúscula.",
      registro: "header-arquivo",
      colunas: [71, 71],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "intervalo");
    if (dsl.condicao.tipo === "intervalo") {
      assert.deepStrictEqual(dsl.condicao.limites, [
        { operador: ">=", valor: "a" },
        { operador: "<=", valor: "z" },
      ]);
      assert.strictEqual(dsl.condicao.comparacao, "estrita");
    }
  });

  it("marca comparacao frouxa em relacional contra literal numerico", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 703,
      condicao_original: "res[0].substring(143, 145) > 31",
      mensagem: "Linha 1, colunas 144 a 145, dia inválido.",
      registro: "header-arquivo",
      colunas: [144, 145],
      alvo: "res[0]",
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "intervalo");
    if (dsl.condicao.tipo === "intervalo") {
      assert.strictEqual(dsl.condicao.comparacao, "frouxa");
    }
  });

  it("classifica conjuncao de campos diferentes e publica as duas faixas", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 704,
      condicao_original:
        'res[i].substring(17, 18) == "1" && res[i].substring(20, 21) == "0"',
      mensagem: "Linha {linha}, combinação inválida.",
      registro: "segmento-a",
      colunas: [18, 21],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "conjuncao");
    if (dsl.condicao.tipo === "conjuncao") {
      assert.deepStrictEqual(
        dsl.condicao.partes.map((p) => p.tipo),
        ["literal_fixo", "literal_fixo"]
      );
    }
    assert.deepStrictEqual(
      dsl.posicoes.map((p) => p.colunas),
      [
        [18, 18],
        [21, 21],
      ]
    );
    assert.deepStrictEqual(dsl.colunas, [18, 21]);
  });

  it("conjuncao com parte nao modelada continua custom", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 705,
      condicao_original:
        'res[i].substring(17, 18) == "1" && funcaoEstranha(res[i]) > 3',
      mensagem: "Linha {linha}, combinação inválida.",
      registro: "segmento-a",
      colunas: [18, 18],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "multipag");
    assert.strictEqual(dsl.condicao.tipo, "custom");
  });
  it("classifica comparacao entre dois campos da mesma linha como coerencia", () => {
    // O fonte compara datas entre si: "data do desconto superior à do vencimento"
    // é faixa contra faixa, no mesmo registro, com operador relacional.
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 800,
      condicao_original: "res[i].substring(142, 150) > res[i].substring(76, 84)",
      mensagem: "Linha {linha}, colunas 143 a 150, Data do primeiro desconto superior a data de vencimento.",
      registro: "segmento-p",
      colunas: [143, 150],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "coerencia_registro");
    if (dsl.condicao.tipo === "coerencia_registro") {
      assert.strictEqual(dsl.condicao.operador, ">");
      assert.strictEqual(dsl.condicao.alvo, "res[i]");
      assert.strictEqual(dsl.condicao.outro, "res[i]");
      assert.deepStrictEqual(dsl.condicao.posicao_outro, { inicio0: 76, fim0: 84 });
    }
  });

  it("nao classifica faixa comparada consigo mesma como coerencia", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 801,
      condicao_original: "res[i].substring(10, 12) == res[i].substring(10, 12)",
      mensagem: "Linha {linha}, colunas 011 a 012, valor inválido.",
      registro: "segmento-p",
      colunas: [11, 12],
      alvo: "res[i]",
    };
    const dsl = mapToDsl(raw, "cobranca-remessa");
    assert.strictEqual(dsl.condicao.tipo, "custom");
  });
});
