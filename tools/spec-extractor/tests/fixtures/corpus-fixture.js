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
