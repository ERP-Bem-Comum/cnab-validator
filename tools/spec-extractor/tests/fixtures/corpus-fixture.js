/*
 * Corpus sintético para teste de reprodutibilidade do extrator.
 * Não contém dados reais nem texto do fonte oficial do Bradesco.
 * Exercita os layouts do ciclo atual via MAPEAMENTO_FUNCOES em src/config.ts.
 */

function validarDadosArquivo240(res) {
  var str = "";
  if (res[0].substring(0, 3) != "237") {
    str += "Linha 1, colunas 001 a 003, Header de arquivo, código do banco inválido.<br>";
  }
  if (isNaN(res[0].substring(3, 7)) || res[0].substring(3, 7).replace(/\s/g, '').length != 0) {
    str += "Linha 1, colunas 004 a 007, Header de arquivo, campo numérico/branco inválido.<br>";
  }
  if (res[0].substring(7, 8) != "A" && res[0].substring(7, 8) != "B" && res[0].substring(7, 8) != "C") {
    str += "Linha 1, coluna 008, Header de arquivo, domínio inválido.<br>";
  }
  if (res[0].substring(8, 19) != calcularModulo11(res[0].substring(8, 19))) {
    str += "Linha 1, colunas 009 a 019, Header de arquivo, módulo 11 inválido.<br>";
  }
  for (var i = 1; i < res.length - 1; i++) {
    if (res[i].substring(0, 1) != res[i + 1].substring(0, 1)) {
      str += "Linha " + (i + 1) + ", coluna 001, Segmento P, coerência entre registros inválida.<br>";
    }
  }
  if ((res[0].substring(19, 20) >= 'a') && (res[0].substring(19, 20) <= 'z')) {
    str += "Linha 1, coluna 020, Header de arquivo, regra custom inválida.<br>";
  }
  return str;
}

function validarDadosArquivo400(res) {
  var str = "";
  if (res[0].substring(0, 3) != "237") {
    str += "Linha 1, colunas 001 a 003, Header de arquivo, código do banco inválido.<br>";
  }
  if (res[0].substring(3, 7) != "0000") {
    str += "Linha 1, colunas 004 a 007, Header de arquivo, literal fixo inválido.<br>";
  }
  return str;
}

function validarDadosMultipag(res) {
  var str = "";
  if (res[0].substring(0, 3) != "237") {
    str += "Linha 1, colunas 001 a 003, Header de arquivo, código do banco inválido.<br>";
  }
  if (isNaN(res[0].substring(3, 7)) || res[0].substring(3, 7).replace(/\s/g, '').length != 0) {
    str += "Linha 1, colunas 004 a 007, Header de arquivo, campo numérico/branco inválido.<br>";
  }
  if (res[0].substring(7, 8) != "S" && res[0].substring(7, 8) != "N") {
    str += "Linha 1, coluna 008, Header de arquivo, domínio inválido.<br>";
  }
  return str;
}

function validarDadosFolha240(res) {
  var str = "";
  if (res[0].substring(0, 3) != "237") {
    str += "Linha 1, colunas 001 a 003, Header de arquivo, código do banco inválido.<br>";
  }
  if (res[0].substring(3, 7) != "0000") {
    str += "Linha 1, colunas 004 a 007, Header de arquivo, literal fixo inválido.<br>";
  }
  for (var i = 1; i < res.length - 1; i++) {
    if (res[i].substring(0, 1) != res[i + 1].substring(0, 1)) {
      str += "Linha " + (i + 1) + ", coluna 001, Segmento P, coerência entre registros inválida.<br>";
    }
  }
  return str;
}

function validarDadosFolha200(res) {
  var str = "";
  if (res[0].substring(0, 3) != "237") {
    str += "Linha 1, colunas 001 a 003, Header de arquivo, código do banco inválido.<br>";
  }
  if ((res[0].substring(3, 4) >= 'a') && (res[0].substring(3, 4) <= 'z')) {
    str += "Linha 1, coluna 004, Header de arquivo, regra custom inválida.<br>";
  }
  return str;
}

// Retorno: o fonte tem forma de dicionário, não de regra. O catálogo vive numa
// função aninhada, e o campo de ocorrências carrega mais de um código.
function retorno_multipag_folha240(res) {
  var resposta = "";
  var i = 0;
  while (i < res.length) {
    if (isNaN(res[i].substring(230, 240))) ocorrencias();
    i++;
    function ocorrencias() {
      if (res[i].substring(7, 8) == "0")
        resposta = resposta + "<pre><b>Header de Arquivo</b> ";
      if (res[i].substring(7, 8) == 1)
        resposta = resposta + "<pre><b>Header de Lote</b> ";
      if (res[i].substring(7, 8) == 5)
        resposta = resposta + "<pre><b>Trailer de Lote</b> ";
      if (res[i].substring(7, 8) == 9)
        resposta = resposta + "<pre><b>Trailer de Arquivo</b> ";
      if (res[i].substring(230, 232) == "XX")
        resposta = resposta + "      XX - Codigo fora do manual.";
      if (res[i].substring(230, 232) == "BD")
        resposta = resposta + "<b>      BD - Agendado.</b>";
      if (res[i].substring(230, 232) == 00 && res[i].substring(13, 14) != "B")
        resposta = resposta + "      00 - Efetivado";
      if (res[i].substring(230, 232) == 01)
        resposta = resposta + "      01 - Recusado";
      if (res[i].substring(230, 232) == 02)
        resposta = resposta + "      02 - Cancelado";
      if (res[i].substring(232, 234) == "XX")
        resposta = resposta + " / XX - Codigo fora do manual.";
      if (res[i].substring(232, 234) == "BD")
        resposta = resposta + " / BD - Agendado.";
      if (res[i].substring(232, 234) == 01)
        resposta = resposta + " / 01 - Recusado";
      if (res[i].substring(232, 234) == 02)
        resposta = resposta + " / 02 - Cancelado";
      if (res[i].substring(234, 236) == "XX")
        resposta = resposta + " / XX - Codigo fora do manual.";
      if (res[i].substring(234, 236) == "BD")
        resposta = resposta + " / BD - Agendado.";
      if (res[i].substring(234, 236) == 01)
        resposta = resposta + " / 01 - Recusado";
      if (res[i].substring(234, 236) == 02)
        resposta = resposta + " / 02 - Cancelado";
      if (res[i].substring(236, 238) == "XX")
        resposta = resposta + " / XX - Codigo fora do manual.";
      if (res[i].substring(236, 238) == "BD")
        resposta = resposta + " / BD - Agendado.";
      if (res[i].substring(236, 238) == 01)
        resposta = resposta + " / 01 - Recusado";
      if (res[i].substring(236, 238) == 02)
        resposta = resposta + " / 02 - Cancelado";
      if (res[i].substring(238, 240) == "XX")
        resposta = resposta + " / XX - Codigo fora do manual.";
      if (res[i].substring(238, 240) == "BD")
        resposta = resposta + " / BD - Agendado.";
      if (res[i].substring(238, 240) == 01)
        resposta = resposta + " / 01 - Recusado";
      if (res[i].substring(238, 240) == 02)
        resposta = resposta + " / 02 - Cancelado";
      resposta = resposta + "=====================================";
    }
  }
  return resposta;
}
