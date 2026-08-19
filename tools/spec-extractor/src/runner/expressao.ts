/**
 * Avaliador das expressões que o extrator preserva como texto — hoje só as
 * guardas (`condicao_guarda`), que a DSL não modela.
 *
 * Não é um interpretador de JavaScript: reconhece exatamente as formas que o
 * validador do Bradesco usa e **recusa** o resto, em vez de adivinhar. Uma guarda
 * que não é reconhecida faz a regra ser reportada como não avaliada — nunca como
 * aprovada.
 *
 * Os operadores são aplicados com os operadores do próprio JavaScript. É de
 * propósito: o fonte compara string com número o tempo todo, e a coerção faz
 * parte do comportamento que o spec precisa reproduzir. A Fase 1, em Rust, é que
 * vai ter de imitar isto — e o runner é o oráculo contra o qual ela se mede.
 */

export type Valor = string | number | boolean;

export class ExpressaoNaoSuportada extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = "ExpressaoNaoSuportada";
  }
}

export interface ContextoArquivo {
  /** Linhas do arquivo, sem quebra de linha. */
  linhas: string[];
  /** Índice 0-based da linha corrente (`i` no fonte). */
  i: number;
  /** Variáveis já resolvidas — o `resto` do cálculo de dígito, por exemplo. */
  variaveis?: Record<string, Valor>;
}

/** `res[k]` fora dos limites é string vazia, não erro — o fonte não checa nada. */
export function linhaDe(ctx: ContextoArquivo, indice: number): string {
  return ctx.linhas[indice] ?? "";
}

type Token =
  | { tipo: "numero"; valor: number }
  | { tipo: "texto"; valor: string }
  | { tipo: "nome"; valor: string }
  | { tipo: "regex"; valor: string }
  | { tipo: "simbolo"; valor: string };

const SIMBOLOS_DUPLOS = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||"];

function tokenizar(fonte: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < fonte.length) {
    const char = fonte[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      let valor = "";
      i++;
      while (i < fonte.length && fonte[i] !== char) {
        valor += fonte[i];
        i++;
      }
      if (i >= fonte.length) throw new ExpressaoNaoSuportada("string sem fechamento");
      i++;
      tokens.push({ tipo: "texto", valor });
      continue;
    }

    // `/\s/g` e `/\d/g` do `replace`: só estes dois aparecem no fonte.
    if (char === "/") {
      const fim = fonte.indexOf("/", i + 1);
      if (fim === -1) throw new ExpressaoNaoSuportada("regex sem fechamento");
      const corpo = fonte.slice(i + 1, fim);
      i = fim + 1;
      while (i < fonte.length && /[a-z]/.test(fonte[i])) i++;
      tokens.push({ tipo: "regex", valor: corpo });
      continue;
    }

    if (/[0-9]/.test(char)) {
      let bruto = "";
      while (i < fonte.length && /[0-9.]/.test(fonte[i])) {
        bruto += fonte[i];
        i++;
      }
      tokens.push({ tipo: "numero", valor: Number(bruto) });
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      let nome = "";
      while (i < fonte.length && /[\w$]/.test(fonte[i])) {
        nome += fonte[i];
        i++;
      }
      tokens.push({ tipo: "nome", valor: nome });
      continue;
    }

    const duplo = SIMBOLOS_DUPLOS.find((s) => fonte.startsWith(s, i));
    if (duplo) {
      tokens.push({ tipo: "simbolo", valor: duplo });
      i += duplo.length;
      continue;
    }

    if ("()[].,+-*<>!%".includes(char)) {
      tokens.push({ tipo: "simbolo", valor: char });
      i++;
      continue;
    }

    throw new ExpressaoNaoSuportada(`caractere não suportado: ${char}`);
  }

  return tokens;
}

/**
 * Variáveis que o fonte recalcula a cada linha, e que aparecem nas guardas. São
 * **booleanos** sobre a linha corrente, não índices — o que explica a forma
 * `Header_arquivo < i > Trailer_arquivo`, cuja avaliação passa por duas coerções.
 */
const CONTEXTO_DE_LINHA: Record<string, (linha: string) => boolean> = {
  Header_arquivo: (linha) => (linha.substring(3, 17) as unknown as number) == 0,
  Trailer_arquivo: (linha) => (linha.substring(3, 8) as unknown as number) == 99999,
  Header_lote: (linha) =>
    (linha.substring(7, 8) as unknown as number) == 1 && linha.substring(8, 9) === "C",
  Trailer_lote: (linha) =>
    (linha.substring(7, 8) as unknown as number) == 5 &&
    (linha.substring(8, 17) as unknown as number) == 0,
};

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly ctx: ContextoArquivo
  ) {}

  avaliar(): Valor {
    const valor = this.ou();
    if (this.pos < this.tokens.length) {
      throw new ExpressaoNaoSuportada("sobrou token depois da expressão");
    }
    return valor;
  }

  private ou(): Valor {
    let esquerda = this.e();
    while (this.consumirSimbolo("||")) {
      const direita = this.e();
      esquerda = esquerda || direita;
    }
    return esquerda;
  }

  private e(): Valor {
    let esquerda = this.comparacao();
    while (this.consumirSimbolo("&&")) {
      const direita = this.comparacao();
      esquerda = esquerda && direita;
    }
    return esquerda;
  }

  /** Associatividade à esquerda: `a < b > c` é `(a < b) > c`, como no JavaScript. */
  private comparacao(): Valor {
    let esquerda = this.unario();
    for (;;) {
      const operador = this.espiarSimbolo();
      if (!operador || !["===", "!==", "==", "!=", "<=", ">=", "<", ">"].includes(operador)) {
        return esquerda;
      }
      this.pos++;
      const direita = this.unario();
      esquerda = aplicarComparacao(operador, esquerda, direita);
    }
  }

  private unario(): Valor {
    if (this.consumirSimbolo("!")) return !this.unario();
    if (this.consumirSimbolo("-")) return -Number(this.unario());
    return this.sufixos(this.primario());
  }

  private primario(): Valor {
    const token = this.tokens[this.pos];
    if (!token) throw new ExpressaoNaoSuportada("expressão incompleta");

    if (token.tipo === "simbolo" && token.valor === "(") {
      this.pos++;
      const valor = this.ou();
      this.exigirSimbolo(")");
      return valor;
    }

    // `[i + 3]` aparece como número de linha em mensagem; nas guardas, o array
    // literal de um elemento vale pelo elemento.
    if (token.tipo === "simbolo" && token.valor === "[") {
      this.pos++;
      const valor = this.ou();
      this.exigirSimbolo("]");
      return valor;
    }

    if (token.tipo === "numero" || token.tipo === "texto") {
      this.pos++;
      return token.valor;
    }

    if (token.tipo === "nome") {
      this.pos++;
      return this.nome(token.valor);
    }

    throw new ExpressaoNaoSuportada(`token inesperado: ${JSON.stringify(token)}`);
  }

  private nome(nome: string): Valor {
    if (nome === "res") {
      this.exigirSimbolo("[");
      const indice = Number(this.aritmetica());
      this.exigirSimbolo("]");
      return linhaDe(this.ctx, indice);
    }

    if (nome === "isNaN") {
      this.exigirSimbolo("(");
      const valor = this.ou();
      this.exigirSimbolo(")");
      return isNaN(Number(valor));
    }

    if (nome === "i") return this.ctx.i;
    // `j = i + 1` no fonte: é sempre a linha seguinte à corrente.
    if (nome === "j") return this.ctx.i + 1;

    const contexto = CONTEXTO_DE_LINHA[nome];
    if (contexto) return contexto(linhaDe(this.ctx, this.ctx.i));

    const variavel = this.ctx.variaveis?.[nome];
    if (variavel !== undefined) return variavel;

    throw new ExpressaoNaoSuportada(`identificador desconhecido: ${nome}`);
  }

  /** Índice de `res[...]`: aceita `i`, `0`, `i + 2`, `i - 1`. */
  private aritmetica(): number {
    let valor = Number(this.termoAritmetico());
    for (;;) {
      if (this.consumirSimbolo("+")) {
        valor += Number(this.termoAritmetico());
        continue;
      }
      if (this.consumirSimbolo("-")) {
        valor -= Number(this.termoAritmetico());
        continue;
      }
      return valor;
    }
  }

  private termoAritmetico(): Valor {
    const token = this.tokens[this.pos];
    if (!token) throw new ExpressaoNaoSuportada("índice incompleto");
    if (token.tipo === "numero") {
      this.pos++;
      return token.valor;
    }
    if (token.tipo === "nome") {
      this.pos++;
      return this.nome(token.valor);
    }
    throw new ExpressaoNaoSuportada("índice não suportado");
  }

  private sufixos(valor: Valor): Valor {
    let atual = valor;
    while (this.consumirSimbolo(".")) {
      const metodo = this.tokens[this.pos];
      if (!metodo || metodo.tipo !== "nome") {
        throw new ExpressaoNaoSuportada("acesso a propriedade não suportado");
      }
      this.pos++;

      if (metodo.valor === "length") {
        atual = String(atual).length;
        continue;
      }

      if (metodo.valor === "substring") {
        this.exigirSimbolo("(");
        const inicio = Number(this.aritmetica());
        this.exigirSimbolo(",");
        const fim = Number(this.aritmetica());
        this.exigirSimbolo(")");
        atual = String(atual).substring(inicio, fim);
        continue;
      }

      if (metodo.valor === "replace") {
        this.exigirSimbolo("(");
        const padrao = this.tokens[this.pos];
        if (!padrao || padrao.tipo !== "regex") {
          throw new ExpressaoNaoSuportada("replace sem padrão literal");
        }
        this.pos++;
        this.exigirSimbolo(",");
        const substituto = this.ou();
        this.exigirSimbolo(")");
        atual = String(atual).replace(new RegExp(padrao.valor, "g"), String(substituto));
        continue;
      }

      throw new ExpressaoNaoSuportada(`método não suportado: ${metodo.valor}`);
    }
    return atual;
  }

  private espiarSimbolo(): string | null {
    const token = this.tokens[this.pos];
    return token && token.tipo === "simbolo" ? token.valor : null;
  }

  private consumirSimbolo(simbolo: string): boolean {
    if (this.espiarSimbolo() === simbolo) {
      this.pos++;
      return true;
    }
    return false;
  }

  private exigirSimbolo(simbolo: string): void {
    if (!this.consumirSimbolo(simbolo)) {
      throw new ExpressaoNaoSuportada(`esperava ${simbolo}`);
    }
  }
}

export function aplicarComparacao(operador: string, a: Valor, b: Valor): boolean {
  switch (operador) {
    case "==":
      // eslint-disable-next-line eqeqeq
      return a == b;
    case "!=":
      // eslint-disable-next-line eqeqeq
      return a != b;
    case "===":
      return a === b;
    case "!==":
      return a !== b;
    case "<":
      return (a as number) < (b as number);
    case ">":
      return (a as number) > (b as number);
    case "<=":
      return (a as number) <= (b as number);
    case ">=":
      return (a as number) >= (b as number);
    default:
      throw new ExpressaoNaoSuportada(`operador não suportado: ${operador}`);
  }
}

/** Avalia a expressão do fonte. Lança `ExpressaoNaoSuportada` no que não reconhece. */
export function avaliarExpressao(fonte: string, ctx: ContextoArquivo): boolean {
  return Boolean(new Parser(tokenizar(fonte), ctx).avaliar());
}
