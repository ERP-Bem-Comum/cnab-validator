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
    assert.strictEqual(dsl.condicao.tipo, "custom");
  });

  it("nao classifica modulo_11 quando posicoes do comparado e do calculo nao batem", () => {
    const raw: RawRule = {
      funcao_origem: "amostra",
      linha_fonte: 997,
      condicao_original:
        'res[0].substring(13, 27) != calcularModulo11(res[0].substring(0, 9))',
      mensagem: "Modulo 11 invalido.",
      registro: null,
      colunas: [13, 27],
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

  it("classifica modulo_11 com variantes de nome de funcao", () => {
    for (const fn of ["modulo11", "calcModulo11", "calcularDigitoVerificador"]) {
      const raw: RawRule = {
        funcao_origem: "amostra",
        linha_fonte: 989,
        condicao_original: `res[0].substring(13, 27) != ${fn}(res[0].substring(13, 27))`,
        mensagem: "Modulo 11 invalido.",
        registro: null,
        colunas: [13, 27],
        alvo: "res[0]",
      };
      const dsl = mapToDsl(raw, "cobranca-remessa");
      assert.strictEqual(dsl.condicao.tipo, "modulo_11", `deveria reconhecer ${fn}`);
    }
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
    assert.strictEqual(dsl.condicao.tipo, "custom");
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
});
