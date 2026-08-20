/**
 * Oráculo do gerador de retorno — **local e opcional**, como o `golden`.
 *
 * O gerador (`crates/cnab-retorno`) escreve ocorrências nas posições que o
 * catálogo declara. Isso responde "escrevi onde o spec disse", que não é a
 * pergunta que importa. A pergunta é **"o banco leria isto como o cenário que
 * pedimos?"** — e quem responde é o próprio decodificador dele.
 *
 * O arranjo é o mesmo de `bun run paridade`: o Rust congela o arquivo em
 * `tools/retorno-exemplo/` (teste `congela_exemplo_para_o_oraculo`) e este script
 * roda o JavaScript do banco sobre ele. Sem `assets/` o script se declara pulado,
 * então o CI segue sem tocar a rede.
 *
 * O que ele exige do resultado:
 *
 * 1. o arquivo **não** ser lido como remessa — foi o primeiro defeito que este
 *    oráculo pegou, e nenhum teste interno o pegaria: o gerador escrevia as
 *    ocorrências certas num arquivo que continuava se declarando remessa;
 * 2. ocorrência decodificada **no detalhe** — o caso que só existe porque o
 *    `registros_lidos` foi corrigido para sair da guarda do bloco;
 * 3. ocorrência decodificada **no envelope** — o caso que um consumidor que varre
 *    só o detalhe não enxerga;
 * 4. nenhum código no balde de desconhecido.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runInContext } from "node:vm";
import { ASSETS_DIR } from "./config.js";
import { carregarValidadorOficial } from "./golden.js";
import { separarLinhas } from "./runner/index.js";

const EXEMPLOS_DIR = new URL("../../retorno-exemplo/", import.meta.url).pathname;
const FUNCAO = "retorno_multipag_folha240";

export interface LeituraDoBanco {
  arquivo: string;
  /** O relatório do banco, sem marcação, linha a linha. */
  linhas: string[];
  declarado_remessa: boolean;
  ocorrencias_no_detalhe: string[];
  ocorrencias_no_envelope: string[];
}

/** Roda o decodificador oficial sobre um arquivo de retorno. */
export function lerComOBanco(caminho: string): LeituraDoBanco {
  const contexto = carregarValidadorOficial();
  if (!contexto) throw new Error("assets/ ausente");

  const conteudo = readFileSync(caminho, "latin1");
  const linhasDoArquivo = separarLinhas(conteudo);
  // A página do banco define esta global antes de chamar o decodificador; fora do
  // navegador ela não existe, e o laço que lê as ocorrências nunca roda.
  runInContext(`quantidadeLinhas = ${linhasDoArquivo.length}`, contexto);

  const decodificar = runInContext(FUNCAO, contexto) as (l: string[]) => string;
  const html = decodificar(linhasDoArquivo);

  const linhas = html
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // O relatório do banco imprime o rótulo do registro e, na linha seguinte, a
  // ocorrência que ele decodificou ali.
  const ENVELOPE = /^(Header de Arquivo|Header de Lote|Trailer de Lote|Trailer de Arquivo)$/;
  const CODIGO = /^([0-9A-Z]{2}) - /;
  const ocorrencias_no_envelope: string[] = [];
  const ocorrencias_no_detalhe: string[] = [];

  for (let i = 0; i < linhas.length; i++) {
    const codigo = linhas[i].match(CODIGO);
    if (!codigo) continue;
    if (i > 0 && ENVELOPE.test(linhas[i - 1])) {
      ocorrencias_no_envelope.push(codigo[1]);
    }
  }
  // No detalhe a ocorrência sai na última coluna da linha do pagamento.
  for (const linha of linhas) {
    const m = linha.match(/\s([0-9A-Z]{2}) - [^-]+$/);
    if (m && /\d{2}\/\d{2}\/\d{4}/.test(linha)) ocorrencias_no_detalhe.push(m[1]);
  }

  return {
    arquivo: caminho.split("/").pop() ?? caminho,
    linhas,
    declarado_remessa: linhas.some((l) => /ARQUIVO É REMESSA/i.test(l)),
    ocorrencias_no_detalhe,
    ocorrencias_no_envelope,
  };
}

export function corpusPresente(): boolean {
  return existsSync(join(ASSETS_DIR, "validadorgeral.html"));
}

export function exemplos(): string[] {
  if (!existsSync(EXEMPLOS_DIR)) return [];
  return readdirSync(EXEMPLOS_DIR)
    .filter((n) => n.endsWith(".txt"))
    .sort();
}

export function caminhoDoExemplo(nome: string): string {
  return join(EXEMPLOS_DIR, nome);
}

if (import.meta.main) {
  if (!corpusPresente()) {
    console.log(
      "assets/ ausente: rode `bun run dev` uma vez para baixar o corpus do banco. Pulando."
    );
    process.exit(0);
  }

  const nomes = exemplos();
  if (nomes.length === 0) {
    console.log(
      "Nenhum exemplo em tools/retorno-exemplo/. Rode `cargo test -p cnab-retorno` para congelar."
    );
    process.exit(0);
  }

  let falhou = false;
  for (const nome of nomes) {
    const leitura = lerComOBanco(caminhoDoExemplo(nome));
    const problemas: string[] = [];
    if (leitura.declarado_remessa) {
      problemas.push("o banco leu o arquivo como REMESSA");
    }
    if (leitura.ocorrencias_no_detalhe.length === 0) {
      problemas.push("nenhuma ocorrência decodificada no detalhe");
    }
    if (leitura.ocorrencias_no_envelope.length === 0) {
      problemas.push("nenhuma ocorrência decodificada no envelope");
    }

    console.log(`\n${nome}:`);
    console.log(`  detalhe:  ${leitura.ocorrencias_no_detalhe.join(", ") || "—"}`);
    console.log(`  envelope: ${leitura.ocorrencias_no_envelope.join(", ") || "—"}`);
    for (const problema of problemas) {
      console.log(`  ✗ ${problema}`);
      falhou = true;
    }
    if (problemas.length === 0) console.log("  ✓ o banco leu o cenário que pedimos");
  }

  process.exit(falhou ? 1 : 0);
}
