function amostra(res) {
  var str = "";
  if (res[0].substring(3, 7) != "0000") {
    str += "Literal fixo invalido.<br>";
  }
  if (isNaN(res[0].substring(7, 11)) || res[0].substring(7, 11).replace(/\s/g, '').length != 0) {
    str += "Numerico/branco invalido.<br>";
  }
  if (res[0].substring(11, 13) != "01" && res[0].substring(11, 13) != "02" && res[0].substring(11, 13) != "03") {
    str += "Dominio invalido.<br>";
  }
  if (res[0].substring(13, 27) != calcularModulo11(res[0].substring(13, 27))) {
    str += "Modulo 11 invalido.<br>";
  }
  if (res[i].substring(0, 1) != res[i + 1].substring(0, 1)) {
    str += "Coerencia entre registros invalida.<br>";
  }
  return str;
}
