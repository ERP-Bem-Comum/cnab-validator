import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  digitosAceitos,
  parametrosDoSpec,
  restoDe,
  verificarDigito,
  verificarPar,
} from "../src/digito-verificador.js";
import type { DslRule } from "../src/rule-mapper.js";

const regras = JSON.parse(
  readFileSync(new URL("../../specs/layouts/multipag.json", import.meta.url), "utf-8")
).regras as DslRule[];

const parametros = parametrosDoSpec(regras);

/**
 * Pares sintéticos. Nenhum dado real de cadastro: os valores foram escolhidos
 * para cair em cada faixa de resto, e os dígitos vêm do próprio algoritmo.
 */
const AGENCIA = { valor: "01234", digito: "3" };
const CONTA = { valor: "000000567890", digito: "0" };
const AGENCIA_RESTO_1 = "00006";

describe("dígito verificador derivado do spec", () => {
  it("os parâmetros vêm do spec, não do código", () => {
    assert.deepStrictEqual(parametros.agencia.pesos, [5, 4, 3, 2]);
    assert.deepStrictEqual(parametros.conta.pesos, [2, 7, 6, 5, 4, 3, 2]);
    assert.strictEqual(parametros.agencia.modulo, 11);
    assert.deepStrictEqual(parametros.agencia.colunas_digito, [29, 29]);
    assert.deepStrictEqual(parametros.conta.colunas_digito, [42, 42]);
  });

  it("CA1 — reproduz o veredito do validador para a agência", () => {
    assert.strictEqual(
      verificarDigito(AGENCIA.valor, AGENCIA.digito, regras, "agencia").valido,
      true
    );
    assert.strictEqual(verificarDigito(AGENCIA.valor, "4", regras, "agencia").valido, false);
    assert.strictEqual(
      verificarDigito(AGENCIA.valor, "4", regras, "agencia").motivo,
      "digito_incorreto"
    );
  });

  it("CA1 — no resto 1 o validador aceita os dois dígitos, e o spec diz por quê", () => {
    // O fonte repete o bloco de cálculo por valor informado no dígito: num ramo o
    // resto 1 espera zero, no outro espera o caractere alternativo. O efeito
    // líquido é que ambos passam — uma reimplementação que escolha um só reprova
    // arquivo que o oficial aprova.
    assert.strictEqual(restoDe(AGENCIA_RESTO_1, parametros.agencia), 1);
    assert.deepStrictEqual(digitosAceitos(AGENCIA_RESTO_1, regras, "agencia"), ["0", "P"]);
    assert.strictEqual(verificarDigito(AGENCIA_RESTO_1, "0", regras, "agencia").valido, true);
    assert.strictEqual(verificarDigito(AGENCIA_RESTO_1, "P", regras, "agencia").valido, true);
  });

  it("resto 0 não usa o caractere alternativo", () => {
    const contaResto0 = CONTA.valor;
    assert.strictEqual(restoDe(contaResto0, parametros.conta), 0);
    assert.deepStrictEqual(digitosAceitos(contaResto0, regras, "conta"), ["0"]);
  });

  it("CA2 — o caractere alternativo em caixa baixa é recusado", () => {
    const veredito = verificarDigito(AGENCIA_RESTO_1, "p", regras, "agencia");
    assert.strictEqual(veredito.valido, false);
    assert.strictEqual(veredito.motivo, "caixa_baixa");
    // O maiúsculo continua válido: a recusa é da caixa, não do caractere.
    assert.strictEqual(verificarDigito(AGENCIA_RESTO_1, "P", regras, "agencia").valido, true);
  });

  it("CA2 — o veredito da conta reproduz o do validador", () => {
    assert.strictEqual(verificarDigito(CONTA.valor, CONTA.digito, regras, "conta").valido, true);
    assert.strictEqual(verificarDigito(CONTA.valor, "7", regras, "conta").valido, false);
  });

  it("CA3 — fora do banco aplicável nada é verificado", () => {
    const outroBanco = verificarPar(
      {
        banco: "341",
        agencia: AGENCIA.valor,
        digito_agencia: "9",
        conta: CONTA.valor,
        digito_conta: "9",
      },
      regras
    );
    // O validador não verifica o dígito na remessa para favorecido de outra
    // instituição; afirmar erro aqui inventaria uma regra que o banco não aplica.
    assert.strictEqual(outroBanco.aplicavel, false);
    assert.strictEqual(outroBanco.valido, true);
    assert.strictEqual(outroBanco.agencia, undefined);
    assert.strictEqual(parametros.agencia.banco_aplicavel, "237");
  });

  it("CA4 — o cálculo é consumível sobre um par, sem gerar arquivo", () => {
    const veredito = verificarPar(
      {
        banco: "237",
        agencia: AGENCIA.valor,
        digito_agencia: AGENCIA.digito,
        conta: CONTA.valor,
        digito_conta: CONTA.digito,
      },
      regras
    );
    assert.strictEqual(veredito.aplicavel, true);
    assert.strictEqual(veredito.valido, true);
    assert.strictEqual(veredito.agencia?.motivo, "confere");
    assert.strictEqual(veredito.conta?.motivo, "confere");
  });

  it("CA5 — pega o dígito da agência ocupando a posição do dígito da conta", () => {
    // É o cenário exato sob investigação no core-api: o cadastro guardou o dígito
    // da agência onde deveria estar o da conta. Com o cálculo, deixa de ser
    // suspeita estatística e vira veredito nominal.
    const contaminado = verificarPar(
      {
        banco: "237",
        agencia: AGENCIA.valor,
        digito_agencia: AGENCIA.digito,
        conta: CONTA.valor,
        digito_conta: AGENCIA.digito,
      },
      regras
    );
    assert.strictEqual(contaminado.valido, false);
    assert.strictEqual(contaminado.agencia?.valido, true);
    assert.strictEqual(contaminado.conta?.valido, false);
    assert.strictEqual(contaminado.conta?.motivo, "digito_incorreto");
    assert.deepStrictEqual(contaminado.conta?.aceitos, [CONTA.digito]);
  });

  it("valor não numérico não vira dígito inventado", () => {
    const veredito = verificarDigito("0AB34", "3", regras, "agencia");
    assert.strictEqual(veredito.valido, false);
    assert.strictEqual(veredito.motivo, "valor_nao_numerico");
    assert.deepStrictEqual(veredito.aceitos, []);
  });

  it("o corpus sintético usa dígitos que este cálculo aprova", () => {
    // Amarra o corpus ao algoritmo: se um mudar, o outro acusa.
    const linhas = readFileSync(
      new URL("./fixtures/corpus/multipag-correto.txt", import.meta.url),
      "utf-8"
    ).split("\n");
    const segmentoA = linhas[2];
    const veredito = verificarPar(
      {
        banco: segmentoA.substring(20, 23),
        agencia: segmentoA.substring(23, 28),
        digito_agencia: segmentoA.substring(28, 29),
        conta: segmentoA.substring(29, 41),
        digito_conta: segmentoA.substring(41, 42),
      },
      regras
    );
    assert.strictEqual(veredito.aplicavel, true);
    assert.strictEqual(veredito.valido, true);
  });
});
