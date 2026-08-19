import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { extractRulesFromFunction } from "../src/ast-walker.js";

const fixture = readFileSync(
  new URL("./fixtures/sample-cobranca.js", import.meta.url),
  "utf-8"
);

describe("extractRulesFromFunction", () => {
  it("extracts rules from a function declaration", () => {
    const rules = extractRulesFromFunction(fixture, "validarDadosArquivo240");
    assert.strictEqual(rules.length, 3);
    assert.strictEqual(rules[0].registro, "header-arquivo");
    assert.strictEqual(rules[0].condicao_original, 'res[0].substring(3, 7) != "0000"');
    assert.deepStrictEqual(rules[0].colunas, [4, 7]);
    assert.strictEqual(rules[0].alvo, "res[0]");
    assert.deepStrictEqual(rules[1].colunas, [143, 143]);
    assert.strictEqual(rules[2].registro, "segmento-p");
    assert.strictEqual(rules[2].alvo, "res[i]");
  });

  it("extracts rules from a function expression", () => {
    const rules = extractRulesFromFunction(fixture, "validarComoExpressao");
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].registro, "header-lote");
    assert.deepStrictEqual(rules[0].colunas, [1, 3]);
    assert.strictEqual(rules[0].alvo, "res[1]");
    assert.strictEqual(rules[0].condicao_original, 'res[1].substring(0, 3) != "077"');
    assert.strictEqual(rules[1].registro, "header-lote");
    assert.strictEqual(rules[1].condicao_original, '!(res[1].substring(0, 3) != "077")');
    assert.strictEqual(rules[1].mensagem, "Linha 2, colunas 001-003, Header de lote, código do banco divergente.<br>");
  });

  it("extracts rules from an arrow function", () => {
    const rules = extractRulesFromFunction(fixture, "validarComoArrow");
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].registro, "segmento-q");
    assert.deepStrictEqual(rules[0].colunas, [4, 7]);
    assert.deepStrictEqual(rules[0].alvo, "res[2]");
    assert.strictEqual(rules[1].mensagem, "Aviso genérico sem colunas, preenchimento obrigatório.<br>");
    assert.strictEqual(rules[1].colunas, null);
    assert.strictEqual(rules[1].registro, null);
  });

  it("handles else branches and single column ranges", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0] === "x") {
          str += "Header do arquivo, coluna 001, valor inválido.<br>";
        } else {
          str += "Header do arquivo, coluna 001, falhou.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 2);
    assert.deepStrictEqual(rules[0].colunas, [1, 1]);
    assert.deepStrictEqual(rules[1].colunas, [1, 1]);
    assert.strictEqual(rules[0].registro, "header-arquivo");
    assert.strictEqual(rules[1].registro, "header-arquivo");
  });

  it("handles multi-res conditions", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0].x != "a" && res[1].y != "b") {
          str += "Segmento R, colunas 001-003, erro.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].alvo, "res[0]");
  });

  it("returns null for unclassified registers and invalid columns", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0] === "x") {
          str += "Registro não identificado.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].registro, null);
    assert.strictEqual(rules[0].colunas, null);
    assert.strictEqual(rules[0].alvo, "res[0]");
  });

  it("tolerates uppercase and lowercase register synonyms", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0] === "x") {
          str += "HEADER DE ARQUIVO, colunas 001 a 005, erro.<br>";
        }
        if (res[0] === "y") {
          str += "header do arquivo, colunas 001 a 005, erro.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].registro, "header-arquivo");
    assert.strictEqual(rules[1].registro, "header-arquivo");
  });

  it("uses the last definition when function names are duplicated", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0] === "x") {
          str += "Header de arquivo, colunas 001 a 003, erro.<br>";
        }
        return str;
      }
      function test(res) {
        var str = "";
        if (res[0] === "y") {
          str += "Segmento Q, colunas 010 a 020, erro.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].registro, "segmento-q");
    assert.deepStrictEqual(rules[0].colunas, [10, 20]);
    assert.strictEqual(rules[0].condicao_original, 'res[0] === "y"');
  });

  it("returns empty array when function is not found", () => {
    const rules = extractRulesFromFunction(fixture, "naoExiste");
    assert.deepStrictEqual(rules, []);
  });

  it("recurses into nested if statements and merges guard conditions", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0].substring(7, 8) == "3") {
          if (res[0].substring(13, 14) != "A") {
            str += "Linha 2, Segmento A, coluna 014, código inválido.<br>";
          }
          if (res[0].substring(17, 18) == "2") {
            str += "Linha 2, Segmento A, coluna 018, tipo inválido.<br>";
          }
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 2);
    assert.strictEqual(rules[0].registro, "segmento-a");
    assert.strictEqual(
      rules[0].condicao_original,
      '(res[0].substring(7, 8) == "3") && (res[0].substring(13, 14) != "A")'
    );
    assert.strictEqual(rules[1].registro, "segmento-a");
    assert.strictEqual(
      rules[1].condicao_original,
      '(res[0].substring(7, 8) == "3") && (res[0].substring(17, 18) == "2")'
    );
  });

  it("merges guards through else-if chains", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0].substring(7, 8) == "1") {
          if (res[0].substring(13, 14) == "A") {
            str += "Segmento A, coluna 014, valor inválido.<br>";
          } else if (res[0].substring(13, 14) == "B") {
            str += "Segmento B, coluna 014, valor inválido.<br>";
          } else {
            str += "Segmento desconhecido, coluna 014, valor inválido.<br>";
          }
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 3);
    assert.strictEqual(rules[0].condicao_original, '(res[0].substring(7, 8) == "1") && (res[0].substring(13, 14) == "A")');
    assert.strictEqual(rules[1].condicao_original, '(res[0].substring(7, 8) == "1") && (!(res[0].substring(13, 14) == "A")) && (res[0].substring(13, 14) == "B")');
    assert.strictEqual(rules[2].condicao_original, '(res[0].substring(7, 8) == "1") && (!(res[0].substring(13, 14) == "A")) && (!(res[0].substring(13, 14) == "B"))');
  });
  it("classifica o registro pela guarda quando a mensagem não o nomeia", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[i].substring(7, 8) == 3) {
          if (res[i].substring(13, 14) == "P") {
            if (res[i].substring(15, 17) != "01") {
              str += "Linha , colunas 016 a 017, código de movimento inválido.<br>";
            }
          }
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].registro, "segmento-p");
    assert.strictEqual(rules[0].registro_origem, "guarda");
    assert.strictEqual(
      rules[0].condicao_propria,
      'res[i].substring(15, 17) != "01"'
    );
    assert.strictEqual(
      rules[0].condicao_guarda,
      '(res[i].substring(7, 8) == 3) && (res[i].substring(13, 14) == "P")'
    );
  });

  it("usa a guarda e registra o segundo registro citado como referência", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[i].substring(7, 8) == 1) {
          if (res[i].substring(18, 32) != res[0].substring(18, 32)) {
            str += "Header de lote, colunas 019 a 032, CNPJ divergente do Header de arquivo.<br>";
          }
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules[0].registro, "header-lote");
    assert.strictEqual(rules[0].registro_referenciado, "header-arquivo");
  });

  it("não deixa o termo mais curto engolir o mais específico", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[0].substring(1, 3) != "XX") {
          str += "Segmento J-52, colunas 002 a 003, valor inválido.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules[0].registro, "segmento-j-52");
  });

  it("guarda negada não identifica registro", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[i].substring(13, 14) == "P") {
          str += "";
        } else {
          if (res[i].substring(15, 17) != "01") {
            str += "Linha , colunas 016 a 017, código inválido.<br>";
          }
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].registro, null);
  });

  it("classifica o CNAB 400 pela coluna 001 e pelo vocabulário próprio", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[i].substring(0, 1) == 1) {
          if (res[i].substring(1, 6) != "00000") {
            str += "Linha , colunas 002 a 006, agência não numérica.<br>";
          }
        }
        if (res[i].substring(20, 21) != "0") {
          str += "Linha , coluna 021, Registro tipo 7, valor inválido.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test", 0, "cnab400");
    assert.strictEqual(rules[0].registro, "registro-tipo-1");
    assert.strictEqual(rules[0].registro_origem, "guarda");
    assert.strictEqual(rules[1].registro, "registro-tipo-7");
    assert.strictEqual(rules[1].registro_origem, "mensagem");
  });

  it("preserva a referência de linha interpolada e ignora o acumulador", () => {
    const code = `
      function test(res) {
        var str = "";
        if (res[i].substring(0, 3) != "237") {
          str = str + "Linha " + (i + 1) + ", colunas 001 a 003, banco inválido.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(code, "test");
    assert.strictEqual(
      rules[0].mensagem,
      "Linha {linha}, colunas 001 a 003, banco inválido.<br>"
    );
  });
  it("captura o ambiente do calculo e nao deixa o ramo irmao vazar", () => {
    // O fonte repete o bloco inteiro do cálculo para cada valor informado no
    // dígito. As duas regras são idênticas no texto e diferem só pelo ramo: se o
    // ambiente vazasse entre eles, o spec publicaria dois resultados
    // contraditórios para o mesmo resto.
    const codigo = `
      function amostra(res) {
        var str = "";
        if (res[0].substring(57, 58) != "P") {
          sm = res[0].substring(53, 54) * 5 + res[0].substring(54, 55) * 4;
          resto = sm;
          resto %= 11;
          if (resto == 1)
            dv = 0;
          if (res[0].substring(57, 58) != dv)
            str += "Linha 1, colunas 058 a 058, Dígito da agência inválido.<br>";
        }
        if (res[0].substring(57, 58) == "P") {
          sm = res[0].substring(53, 54) * 5 + res[0].substring(54, 55) * 4;
          resto = sm;
          resto %= 11;
          if (resto == 1)
            dv = "P";
          if (res[0].substring(57, 58) != dv)
            str += "Linha 1, colunas 058 a 058, Dígito da agência inválido.<br>";
        }
        return str;
      }
    `;
    const rules = extractRulesFromFunction(codigo, "amostra");
    const comDigito = rules.filter((r) => r.condicao_propria?.includes("!= dv"));
    assert.strictEqual(comDigito.length, 2);

    for (const regra of comDigito) {
      const dv = regra.ambiente?.dv;
      assert.ok(dv, "ambiente deveria trazer a variável do dígito");
      assert.strictEqual(dv.length, 1, "cada ramo define o dígito uma vez só");
      // A guarda do ramo já está em `condicao_guarda`; `quando` guarda só o que
      // a atribuição tem a mais — a faixa de resto.
      assert.strictEqual(dv[0].quando, "(resto == 1)");
      assert.ok(regra.ambiente?.resto, "o resto precisa vir junto");
      assert.ok(regra.ambiente?.sm, "a soma ponderada precisa vir junto");
    }

    assert.strictEqual(comDigito[0].ambiente?.dv[0].expressao, "0");
    assert.strictEqual(comDigito[1].ambiente?.dv[0].expressao, '"P"');
  });

  it("nao registra acumulador de mensagem como variavel do calculo", () => {
    const codigo = `
      function amostra(res) {
        var resposta = "";
        if (res[0].substring(3, 7) != "0000")
          resposta = resposta + "Linha 1, colunas 004 a 007, número de lote inválido.<br>";
        return resposta;
      }
    `;
    const rules = extractRulesFromFunction(codigo, "amostra");
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].ambiente, undefined);
  });
  it("aceita regra cuja mensagem nao usa palavra de erro, mas cita linha e coluna", () => {
    // "Número do banco diferente no mesmo lote" não casa nenhuma palavra da lista
    // de indicadores — e é a regra de banco único por lote.
    const codigo = `
      function amostra(res) {
        var resposta = "";
        if (res[i].substring(20, 23) == 237 && res[i + 2].substring(20, 23) != 237)
          resposta = resposta + "Linha " + [i + 3] + ", Segmento A, colunas 021 a 023, Número do banco diferente no mesmo lote.<br>";
        return resposta;
      }
    `;
    const rules = extractRulesFromFunction(codigo, "amostra");
    assert.strictEqual(rules.length, 1);
    assert.deepStrictEqual(rules[0].colunas, [21, 23]);
  });

  it("aceita regra sem referencia de coluna quando o texto indica o erro", () => {
    // Comprimento do registro é sobre a linha inteira: não citar coluna é a
    // modelagem certa dela, não ausência de evidência.
    const codigo = `
      function amostra(res) {
        var resposta = "";
        if (res[i].length != 240)
          resposta = resposta + "Linha " + i + ", Tamanho do registro inválido.<br>";
        return resposta;
      }
    `;
    const rules = extractRulesFromFunction(codigo, "amostra");
    assert.strictEqual(rules.length, 1);
    assert.strictEqual(rules[0].colunas, null);
  });

  it("descarta render de relatorio, que nao tem nem linha e coluna nem indicativo de erro", () => {
    const codigo = `
      function amostra(res) {
        var resposta = "";
        if (res[0].substring(0, 3) == "237")
          resposta = resposta + "Empresa: " + res[0].substring(72, 102) + "<br>";
        return resposta;
      }
    `;
    const rules = extractRulesFromFunction(codigo, "amostra");
    assert.deepStrictEqual(rules, []);
  });
});
