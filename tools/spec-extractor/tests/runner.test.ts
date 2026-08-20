import { describe, it } from "bun:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { aplicarSpec, separarLinhas } from "../src/runner/index.js";
import { avaliarCondicao, calcularResto } from "../src/runner/condicao.js";
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

  it("o trailer de lote com quantidade divergente é reprovado, e só ele", () => {
    // A regra compara a faixa com o sequencial do último detalhe *mais dois*, e
    // ficava em `custom` sem o deslocamento. Enquanto ela não era avaliada, o
    // próprio corpus foi dado por correto com o trailer errado.
    const relatorio = aplicarSpec(
      multipag,
      carregarArquivo("multipag-trailer-lote-divergente.txt")
    );
    assert.strictEqual(relatorio.achados.length, 1);
    assert.strictEqual(relatorio.achados[0].regra_id, "multipag:validarDadosMultipag:1006");
    assert.strictEqual(relatorio.achados[0].linha, 5);
    assert.strictEqual(relatorio.achados[0].registro, "trailer-lote");
  });

  it("o trailer de arquivo com quantidade divergente é reprovado, e só ele", () => {
    // A regra compara a faixa com `j`, o contador do laço — não com literal nem
    // com outra faixa. É a última das duas regras de trailer que o corpus
    // trazia erradas sem ninguém notar.
    const relatorio = aplicarSpec(
      multipag,
      carregarArquivo("multipag-trailer-arquivo-divergente.txt")
    );
    assert.strictEqual(relatorio.achados.length, 1);
    assert.strictEqual(relatorio.achados[0].regra_id, "multipag:validarDadosMultipag:498");
    assert.strictEqual(relatorio.achados[0].linha, 6);
    assert.strictEqual(relatorio.achados[0].registro, "trailer-arquivo");
  });

  it("o dígito do código de barras do tributo confere, e o errado é reprovado", () => {
    // O par exercita o módulo 10 com redução por parcela: o código de barras
    // dos dois arquivos cai no ramo `resto10 != 0`, onde o dígito aceito é o do
    // módulo 10. Cálculo errado viraria falso positivo no primeiro arquivo.
    const correto = aplicarSpec(multipag, carregarArquivo("multipag-tributo-correto.txt"));
    assert.deepStrictEqual(
      correto.achados.map((a) => `${a.regra_id} ${a.mensagem}`),
      []
    );

    const invalido = aplicarSpec(
      multipag,
      carregarArquivo("multipag-tributo-dv-invalido.txt")
    );
    assert.strictEqual(invalido.achados.length, 1);
    assert.strictEqual(invalido.achados[0].registro, "segmento-o");
    assert.match(invalido.achados[0].mensagem, /Dígito Verificador Código de Barras/);
  });

  it("a redução é aplicada parcela a parcela, não ao total", () => {
    // `9 * 2` é 18, que passa de 9 e vira 9; `8 * 1` é 8 e fica. A soma é 17, e
    // o resto do módulo 10 é 7. Reduzir o total daria 26 - 9 = 17 por acaso
    // aqui, mas a diferença aparece assim que duas parcelas excedem.
    const calculo = {
      base: [
        { alvo: "res[0]", inicio0: 0, fim0: 1, peso: 2, transformacao: null },
        { alvo: "res[0]", inicio0: 1, fim0: 2, peso: 2, transformacao: null },
      ],
      modulo: 10,
      dobra: { limite: 9, subtrai: 9 },
    };
    // 9*2 = 18 -> 9, e 8*2 = 16 -> 7. Soma 16, resto 6.
    assert.strictEqual(calcularResto(calculo, { linhas: ["98"], i: 0 }), 6);
    // Sem a redução a soma seria 34, e o resto 4 — outro dígito.
    assert.strictEqual(
      calcularResto({ ...calculo, dobra: null }, { linhas: ["98"], i: 0 }),
      4
    );
  });

  it("a faixa é comparada com o número 1-based da linha, e coagida", () => {
    const condicao = {
      tipo: "numero_da_linha",
      alvo: "res[i]",
      posicao: { inicio0: 0, fim0: 6 },
      operador: "!=",
      fluxo: "j",
      variavel: "qtde_linha",
    } as const;
    const linhas = ["", "", "", "", "", "000006"];
    // `j` é `i + 1`: na sexta linha (i = 5) vale 6, e `"000006"` coage para 6.
    assert.strictEqual(avaliarCondicao(condicao, { linhas, i: 5 }), false);
    assert.strictEqual(avaliarCondicao(condicao, { linhas, i: 4 }), true);
  });

  it("o deslocamento tira a comparação do texto e a leva para o número", () => {
    const coerencia = {
      tipo: "coerencia_registro",
      alvo: "res[0]",
      posicao: { inicio0: 0, fim0: 6 },
      operador: "!=",
      outro: "res[1]",
      posicao_outro: { inicio0: 0, fim0: 5 },
      ajuste: -2,
      ajuste_outro: null,
    } as const;
    // `"000004" - 2` é 4 - 2 = 2, e o `!=` coage `"00002"` para 2: não é erro.
    // Sem o deslocamento o fonte compararia `"000004"` com `"00002"`, textos de
    // larguras diferentes que nunca casariam.
    assert.strictEqual(
      avaliarCondicao(coerencia, { linhas: ["000004", "00002"], i: 0 }),
      false
    );
    assert.strictEqual(
      avaliarCondicao(coerencia, { linhas: ["000005", "00002"], i: 0 }),
      true
    );
    // Faixa não numérica vira NaN, que difere de tudo — inclusive de si mesma.
    // É como o fonte reprova, e não pode virar aprovação silenciosa.
    assert.strictEqual(
      avaliarCondicao(coerencia, { linhas: ["00000X", "00002"], i: 0 }),
      true
    );
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
