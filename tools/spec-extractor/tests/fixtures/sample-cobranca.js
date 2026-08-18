function validarDadosArquivo240(res) {
  var str = "";
  if (res[0].substring(3, 7) != "0000") {
    str += "Linha 1, colunas 004 a 007, Header de arquivo, não contém número de lote 0000.<br>";
  }
  if (res[0].substring(142, 143) != "1") {
    str += "Linha 1, coluna 143, Header de arquivo, Tipo de inscrição inválido.<br>";
  }
  for (var i = 1; i < res.length - 1; i++) {
    if (res[i].substring(13, 14) != "P") {
      str += "Linha " + (i + 1) + ", coluna 014, Segmento P, inválido.<br>";
    }
  }
  return str;
}

const validarComoExpressao = function (res) {
  var str = "";
  if (res[1].substring(0, 3) != "077") {
    str += "Linha 2, colunas 001-003, Header de lote, código do banco inválido.<br>";
  } else {
    str += "Linha 2, colunas 001-003, Header de lote, código do banco OK.<br>";
  }
  return str;
};

const validarComoArrow = (res) => {
  var str = "";
  if (res[2].substring(0, 3) != "077" && res[2].substring(3, 7) != "0001") {
    str += "Linha 3, colunas 004 a 007, Segmento Q, número do lote inválido.<br>";
  }
  if (Date.now() > 0) {
    str += "Aviso genérico sem colunas.<br>";
  }
  return str;
};
