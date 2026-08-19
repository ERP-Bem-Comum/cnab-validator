import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { aplicarSpec, separarLinhas } from "../src/runner/index.js";
import { avaliarCondicao } from "../src/runner/condicao.js";
import { avaliarExpressao, ExpressaoNaoSuportada } from "../src/runner/expressao.js";
import type { DslRule } from "../src/rule-mapper.js";

function carregarSpec(layout: string): DslRule[] {
  const url = new URL(`../../specs/layouts/${layout}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf-8")).regras as DslRule[];
}

function carregarArquivo(nome: string): string[] {
  const url = new URL(`./fixtures/corpus/${nome}`, import.meta.url);
  return separarLinhas(readFileSync(url, "utf-8"));
}

const multipag = carregarSpec("multipag");

describe("runner de conformidade", () => {
  it("CA2 — arquivo correto de crédito em conta não produz achado", () => {
    const relatorio = aplicarSpec(multipag, carregarArquivo("multipag-correto.txt"));
    assert.deepStrictEqual(
      relatorio.achados.map((a) => `${a.regra_id} ${a.mensagem}`),
      []
    );
  });

  it("CA1 — câmara de TED com favorecido no próprio banco é reprovada nas colunas 018 a 020", () => {
    const relatorio = aplicarSpec(
      multipag,
      carregarArquivo("multipag-camara-invalida.txt")
    );
    const camara = relatorio.achados.filter((a) => /Informado 018-TED/.test(a.mensagem));
    assert.strictEqual(camara.length, 1, "esperava exatamente um achado da câmara");
    assert.strictEqual(camara[0].registro, "segmento-a");
    assert.strictEqual(camara[0].linha, 3);
    assert.match(camara[0].mensagem, /colunas 018 a 020/);
    // A regra lê a câmara (018-020) e o banco do favorecido (021-023): a faixa
    // publicada envolve as duas, e a mensagem reporta a que nomeia o erro.
    assert.deepStrictEqual(camara[0].colunas, [18, 23]);
  });

  it("o único campo que muda entre os dois arquivos é a câmara", () => {
    const correto = carregarArquivo("multipag-correto.txt");
    const defeito = carregarArquivo("multipag-camara-invalida.txt");
    assert.strictEqual(correto.length, defeito.length);
    const diferentes = correto
      .map((linha, i) => (linha === defeito[i] ? null : i))
      .filter((i): i is number => i !== null);
    assert.deepStrictEqual(diferentes, [2]);
    assert.strictEqual(correto[2].substring(17, 20), "000");
    assert.strictEqual(defeito[2].substring(17, 20), "018");
  });

  it("CA3 — arquivo truncado conclui, e registro inexistente vira string vazia", () => {
    const relatorio = aplicarSpec(multipag, carregarArquivo("multipag-truncado.txt"));
    assert.strictEqual(relatorio.linhas, 2);
    // O que importa é concluir sem estourar e ainda avaliar regras.
    assert.ok(relatorio.regrasAvaliadas > 0);
    assert.ok(relatorio.achados.length > 0, "arquivo truncado tem de reprovar");
  });

  it("CA4 — regra não avaliada aparece no relatório, nunca sai calada", () => {
    const relatorio = aplicarSpec(multipag, carregarArquivo("multipag-correto.txt"));
    const custom = relatorio.naoAvaliadas.filter((n) => n.motivo === "condicao_custom");
    assert.ok(custom.length > 0, "o spec tem regras custom; elas têm de aparecer");
    for (const nao of relatorio.naoAvaliadas) {
      assert.ok(nao.ocorrencias >= 1);
      assert.ok(
        ["condicao_custom", "condicao_incompleta", "guarda_nao_avaliavel"].includes(
          nao.motivo
        )
      );
    }
    // Nenhuma regra pode estar ao mesmo tempo avaliada e contada como não avaliada
    // sem que o relatório diga qual foi o motivo.
    const semMotivo = relatorio.naoAvaliadas.filter((n) => !n.motivo);
    assert.deepStrictEqual(semMotivo, []);
  });

  it("CA5 — comparação frouxa com campo em branco segue a coerção do fonte", () => {
    const ctx = { linhas: ["   ABC"], i: 0 };
    // `res[0].substring(0, 3) == 0` no fonte: `Number("   ") === 0`, então o campo
    // em branco **passa** na igualdade. Comparar como string diria o contrário.
    assert.strictEqual(
      avaliarCondicao(
        {
          tipo: "literal_fixo",
          alvo: "res[0]",
          posicao: { inicio0: 0, fim0: 3 },
          operador: "==",
          valor: "0",
          comparacao: "frouxa",
        },
        ctx
      ),
      true
    );
    assert.strictEqual(
      avaliarCondicao(
        {
          tipo: "literal_fixo",
          alvo: "res[0]",
          posicao: { inicio0: 0, fim0: 3 },
          operador: "==",
          valor: "0",
          comparacao: "estrita",
        },
        ctx
      ),
      false
    );
  });

  it("a regra do segundo dígito reprova, agora que a guarda resolve o primeiro", () => {
    // A guarda é `substring(30, 31) == dv1`: sem o cálculo de `dv1` publicado, a
    // regra do segundo dígito não era avaliada em arquivo nenhum, e um CPF com o
    // último dígito errado passava limpo.
    const relatorio = aplicarSpec(
      multipag,
      carregarArquivo("multipag-cpf-dv2-invalido.txt")
    );
    const digito = relatorio.achados.filter((a) => /dígito|inscrição\/CPF/i.test(a.mensagem));
    assert.deepStrictEqual(
      digito.map((a) => `${a.registro}:${a.linha}`),
      ["header-arquivo:1", "header-lote:2"],
      "o mesmo CPF está nas duas linhas, e o validador reprova as duas"
    );
    for (const achado of digito) {
      assert.ok(
        (relatorio.naoAvaliadas.find((n) => n.regra_id === achado.regra_id) ?? null) ===
          null,
        "regra que produziu achado não pode constar como não avaliada"
      );
    }
  });

  it("o mesmo CPF com o dígito certo não produz achado nenhum", () => {
    const relatorio = aplicarSpec(multipag, carregarArquivo("multipag-cpf-correto.txt"));
    assert.deepStrictEqual(
      relatorio.achados.map((a) => `${a.regra_id} ${a.mensagem}`),
      []
    );
  });

  it("guarda que depende de função não modelada continua não avaliada", () => {
    // O CNPJ alfanumérico passa cada posição por uma função do fonte que o spec
    // não carrega. Publicar `dv1` não fecha essas: calcular seria inventar.
    const relatorio = aplicarSpec(multipag, carregarArquivo("multipag-correto.txt"));
    const porFuncao = relatorio.naoAvaliadas.filter((n) =>
      /função do fonte não modelada/.test(n.detalhe ?? "")
    );
    assert.ok(porFuncao.length > 0, "a fronteira da função tem de aparecer no relatório");
    for (const nao of porFuncao) {
      assert.strictEqual(nao.motivo, "guarda_nao_avaliavel");
    }
  });

  it("custom nunca é avaliado como aprovado", () => {
    assert.strictEqual(
      avaliarCondicao({ tipo: "custom", alvo: "res[0]" }, { linhas: ["x"], i: 0 }),
      null
    );
  });

  it("composta com parte não avaliável não vira aprovação", () => {
    const resultado = avaliarCondicao(
      {
        tipo: "conjuncao",
        alvo: "res[0]",
        partes: [
          {
            tipo: "literal_fixo",
            alvo: "res[0]",
            posicao: { inicio0: 0, fim0: 1 },
            operador: "==",
            valor: "x",
            comparacao: "estrita",
          },
          { tipo: "custom", alvo: "res[0]" },
        ],
      },
      { linhas: ["x"], i: 0 }
    );
    assert.strictEqual(resultado, null);
  });
});

describe("avaliador de expressão", () => {
  const linhas = carregarArquivo("multipag-correto.txt");
  const ctx = { linhas, i: 0 };

  it("reproduz a comparação encadeada das guardas de posicionamento", () => {
    // `Header_arquivo < i > Trailer_arquivo` no fonte é `(bool < i) > bool`, com
    // duas coerções: as quatro variáveis são booleanas sobre a linha corrente, não
    // índices. No header, `1 < 0` é falso, e a guarda exclui a própria linha; num
    // segmento, `0 < 2` é verdadeiro e o trailer é falso, então vale.
    assert.strictEqual(avaliarExpressao("Header_arquivo < i > Trailer_arquivo", ctx), false);
    assert.strictEqual(
      avaliarExpressao("Header_arquivo < i > Trailer_arquivo", { linhas, i: 2 }),
      true
    );
    // Na última linha, que é o trailer de arquivo, a guarda volta a ser falsa.
    assert.strictEqual(
      avaliarExpressao("Header_arquivo < i > Trailer_arquivo", {
        linhas,
        i: linhas.length - 1,
      }),
      false
    );
  });

  it("lê fora dos limites como string vazia", () => {
    assert.strictEqual(avaliarExpressao('res[9].substring(0, 3) == ""', ctx), true);
  });

  it("recusa o que não reconhece em vez de adivinhar", () => {
    assert.throws(
      () => avaliarExpressao("funcaoDesconhecida(res[0]) == 1", ctx),
      ExpressaoNaoSuportada
    );
  });

  it("curto-circuita como o JavaScript, e não exige o lado que o fonte não olha", () => {
    // A guarda identifica o registro antes de comparar o dígito. Numa linha que
    // não é aquele registro o fonte nunca avalia a segunda metade — avaliá-la
    // faria a regra ser recusada em todo o arquivo por uma variável ausente.
    assert.strictEqual(
      avaliarExpressao('res[0].substring(0, 3) == "999" && res[0].substring(0, 1) == dv1', ctx),
      false
    );
    assert.strictEqual(
      avaliarExpressao('res[0].substring(0, 3) == "237" || naoExiste == 1', ctx),
      true
    );
    // Com a esquerda verdadeira o lado direito volta a ser exigido: o curto-circuito
    // não pode virar desculpa para aprovar o que não se sabe avaliar.
    assert.throws(
      () => avaliarExpressao('res[0].substring(0, 3) == "237" && naoExiste == 1', ctx),
      ExpressaoNaoSuportada
    );
  });

  it("resolve a variável da guarda quando ela é fornecida", () => {
    assert.strictEqual(
      avaliarExpressao("res[0].substring(0, 3) == banco", { ...ctx, variaveis: { banco: 237 } }),
      true
    );
  });
});
