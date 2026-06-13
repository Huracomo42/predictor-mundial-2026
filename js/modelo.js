import { PESOS_DEFAULT, ESTADIOS_ALTITUD } from './config.js';
import { getPesos } from './firebase-db.js';

export async function calcularPrediccion(datosPartido, statsLocal, statsVisitante, psicologico) {
  const pesos = await getPesos();

  const scoreStatLocal = calcularScoreEstadistico(statsLocal, datosPartido.jornada);
  const scoreStatVisitante = calcularScoreEstadistico(statsVisitante, datosPartido.jornada);

  const scorePsicoLocal = calcularScorePsicologico(psicologico.local, datosPartido, 'local', pesos);
  const scorePsicoVisitante = calcularScorePsicologico(psicologico.visitante, datosPartido, 'visitante', pesos);

  const boostLocal = calcularBoost(datosPartido.rankingLocal, datosPartido.jornada);
  const boostVisitante = calcularBoost(datosPartido.rankingVisitante, datosPartido.jornada);

  const totalLocal = ((scoreStatLocal * pesos.estadistico) + (scorePsicoLocal * pesos.psicologico)) * boostLocal;
  const totalVisitante = ((scoreStatVisitante * pesos.estadistico) + (scorePsicoVisitante * pesos.psicologico)) * boostVisitante;

  const apuestas = generarApuestas({
    totalLocal,
    totalVisitante,
    scoreStatLocal,
    scoreStatVisitante,
    scorePsicoLocal,
    scorePsicoVisitante,
    boostLocal,
    boostVisitante,
    statsLocal,
    statsVisitante,
    partido: datosPartido,
    psico: psicologico,
  });
  
  return {
    local: {
      scoreStat: round2(scoreStatLocal),
      scorePsico: round2(scorePsicoLocal),
      boost: round3(boostLocal),
      total: round2(totalLocal),
    },
    visitante: {
      scoreStat: round2(scoreStatVisitante),
      scorePsico: round2(scorePsicoVisitante),
      boost: round3(boostVisitante),
      total: round2(totalVisitante),
    },
    diferencia: round2(Math.abs(totalLocal - totalVisitante)),
    favorito: totalLocal >= totalVisitante ? 'local' : 'visitante',
    apuestas,
    pesos_usados: pesos,
    timestamp: new Date().toISOString(),
    version_modelo: pesos.version || '1.0',
  };
}

function calcularScoreEstadistico(stats, jornada) {
  if (!stats) return 5.0;

  const xgNorm = Math.min((stats.xg_promedio || 1.0) / 2.5, 1) * 10;
  const formaNorm = ((stats.puntos_ultimos7 || 7) / 21) * 10;
  const h2hNorm = ((stats.h2h_victorias || 0.33) ) * 10;
  const cornersNorm = Math.min((stats.corners_promedio || 4.5) / 8, 1) * 10;
  const defensaNorm = Math.max(0, (1 - (stats.goles_concedidos_promedio || 1.2) / 3)) * 10;
  const lesionesNorm = (1 - (stats.lesiones_impacto || 0)) * 10;

  const score = (
    xgNorm * 0.25 +
    formaNorm * 0.20 +
    h2hNorm * 0.10 +
    cornersNorm * 0.15 +
    defensaNorm * 0.15 +
    lesionesNorm * 0.15
  );

  return Math.max(1, Math.min(10, score));
}

function calcularScorePsicologico(psico, partido, rol, pesos) {
  if (!psico) return 5.0;

  let scorePresion = 5.0;
  if (psico.necesita_ganar) scorePresion += 1.5;
  if (psico.venganza_narrativa) scorePresion += 1.2;
  scorePresion -= (psico.rival_maldito || 0) * 0.4;
  scorePresion -= (psico.presion_mediatica || 1) * 0.2;
  scorePresion = Math.max(1, Math.min(10, scorePresion));

  let scoreLocal = 5.0;
  const tipoLocalidad = rol === 'local' ? partido.tipoLocalidad : 'visitante';
  if (tipoLocalidad === 'sede') scoreLocal += 2.0;
  else if (tipoLocalidad === 'local') scoreLocal += 1.0;
  else if (tipoLocalidad === 'visitante') scoreLocal -= 0.5;

  const altitud = ESTADIOS_ALTITUD[partido.estadio] || 0;
  const equipoAdaptadoAltitud = rol === 'local';
  if (altitud > 800 && !equipoAdaptadoAltitud) {
    scoreLocal -= Math.min(2.0, (altitud - 800) / 500);
  }
  scoreLocal = Math.max(1, Math.min(10, scoreLocal));

  let scoreLiderazgo = 5.0;
  if (!psico.lider_disponible) scoreLiderazgo -= 2.0;
  scoreLiderazgo -= (psico.conflicto_interno || 0) * 0.5;
  if (psico.generacion_peak) scoreLiderazgo += 0.8;
  scoreLiderazgo = Math.max(1, Math.min(10, scoreLiderazgo));

  let scoreMomentum = 5.0;
  if (psico.underdog) scoreMomentum += 1.0;
  if (psico.clasifico_sufriendo === 'ultimo') scoreMomentum += 0.5;
  if (psico.humillacion_previa) scoreMomentum -= 0.5;
  scoreMomentum = Math.max(1, Math.min(10, scoreMomentum));

  const catPesos = pesos.categorias;
  const totalCat = catPesos.presion + catPesos.local + catPesos.liderazgo + catPesos.momentum;

  const score = (
    scorePresion * (catPesos.presion / totalCat) +
    scoreLocal * (catPesos.local / totalCat) +
    scoreLiderazgo * (catPesos.liderazgo / totalCat) +
    scoreMomentum * (catPesos.momentum / totalCat)
  );

  return Math.max(1, Math.min(10, score));
}

function calcularBoost(rankingFIFA, jornada) {
  const ranking = Number(rankingFIFA || 24);

  // En FIFA, menor ranking = equipo más fuerte.
  // Aquí calculamos efecto underdog: equipos con ranking más alto reciben más boost emocional.
  const factorUnderdog = Math.min(1, Math.max(0, (ranking - 1) / 47));

  if (jornada === 1) return 1.0 + (0.05 * factorUnderdog);
  if (jornada === 2) return 1.0 + (0.03 * factorUnderdog);
  if (jornada === 3) return 1.0 + (0.015 * factorUnderdog);

  return 1.0 + (0.02 * factorUnderdog);
}

function generarApuestas({
  totalLocal,
  totalVisitante,
  scoreStatLocal,
  scoreStatVisitante,
  scorePsicoLocal,
  scorePsicoVisitante,
  boostLocal,
  boostVisitante,
  statsLocal,
  statsVisitante,
  partido,
  psico,
}) {
  const diffTotal = totalLocal - totalVisitante;
  const absDiffTotal = Math.abs(diffTotal);

  const diffStat = scoreStatLocal - scoreStatVisitante;
  const diffPsico = scorePsicoLocal - scorePsicoVisitante;
  const diffBoost = boostLocal - boostVisitante;

  const xgTotal =
    Number(statsLocal?.xg_promedio || 1.2) +
    Number(statsVisitante?.xg_promedio || 1.2);

  const cornersTotal =
    Number(statsLocal?.corners_promedio || 4.5) +
    Number(statsVisitante?.corners_promedio || 4.5);

  const favorito = diffTotal >= 0 ? partido.nombreLocal : partido.nombreVisitante;
  const underdog = diffTotal >= 0 ? partido.nombreVisitante : partido.nombreLocal;
  const favoritoRol = diffTotal >= 0 ? 'local' : 'visitante';
  const underdogRol = diffTotal >= 0 ? 'visitante' : 'local';

  const psicoFavorito = favoritoRol === 'local' ? psico?.local : psico?.visitante;
  const psicoUnderdog = underdogRol === 'local' ? psico?.local : psico?.visitante;

  const estadisticaYPsicoAlineadas =
    (diffStat >= 0 && diffPsico >= 0) ||
    (diffStat < 0 && diffPsico < 0);

  const estadisticaYPsicoContradictorias =
    Math.abs(diffStat) >= 0.5 &&
    Math.abs(diffPsico) >= 0.5 &&
    !estadisticaYPsicoAlineadas;

  const favoritoConPresion =
    Boolean(psicoFavorito?.necesita_ganar) ||
    Number(psicoFavorito?.presion_mediatica || 0) >= 7 ||
    Number(psicoFavorito?.conflicto_interno || 0) >= 5 ||
    psicoFavorito?.lider_disponible === false;

  const underdogConMomentum =
    Boolean(psicoUnderdog?.underdog) ||
    Boolean(psicoUnderdog?.generacion_peak) ||
    psicoUnderdog?.clasifico_sufriendo === 'ultimo';

  const boostFavoreceFavorito =
    favoritoRol === 'local' ? diffBoost > 0 : diffBoost < 0;

  const contexto = {
    diffTotal,
    absDiffTotal,
    diffStat,
    diffPsico,
    diffBoost,
    xgTotal,
    cornersTotal,
    favorito,
    underdog,
    favoritoRol,
    underdogRol,
    estadisticaYPsicoAlineadas,
    estadisticaYPsicoContradictorias,
    favoritoConPresion,
    underdogConMomentum,
    boostFavoreceFavorito,
  };

  console.log('Contexto apuestas', contexto);

  const segura = generarApuestaSeguraAjustada(contexto);
  const media = generarApuestaMediaAjustada(contexto);
  const malcriada = generarApuestaMalcriadaAjustada(contexto);

  return [segura, media, malcriada];
}

function generarApuestaSeguraAjustada(ctx) {
  if (
    ctx.absDiffTotal >= 1.0 &&
    ctx.estadisticaYPsicoAlineadas &&
    !ctx.favoritoConPresion
  ) {
    const ap = generarApuestaMedia(
      ctx.diffTotal,
      ctx.absDiffTotal,
      ctx.favorito,
      ctx.favoritoRol
    );

    return {
      ...ap,
      tipo: 'segura',
      confianza: round2(Math.min(0.74, ap.confianza + 0.08)),
      razon: `${ap.razon} Estadística y psicología apuntan al mismo lado, por eso se eleva como opción segura.`,
    };
  }

  if (ctx.estadisticaYPsicoContradictorias || ctx.favoritoConPresion) {
    const mercado = ctx.xgTotal <= 2.7 ? 'Menos de 3.5 goles' : 'Más de 1.5 goles';
    const prob = ctx.xgTotal <= 2.7 ? 0.68 : 0.66;
    const cuota = calcularCuota(prob);
    const evCalc = calcularEV(prob, cuota);

    return {
      tipo: 'segura',
      mercado,
      confianza: round2(prob),
      cuota_estimada: cuota,
      EV: round3(evCalc),
      recomendada: prob >= 0.65 && evCalc >= -0.05,
      razon: `Hay señales cruzadas entre estadística y psicología o presión sobre el favorito. Se evita ganador directo y se propone un mercado más amplio.`,
    };
  }

  const ap = generarApuestaSegura(ctx.xgTotal, ctx.cornersTotal);

  if (ctx.boostFavoreceFavorito && ctx.absDiffTotal >= 0.6) {
    return {
      ...ap,
      confianza: round2(Math.min(0.78, ap.confianza + 0.03)),
      razon: `${ap.razon} El boost mundialista favorece al equipo con ventaja, reforzando ligeramente la confianza.`,
    };
  }

  return ap;
}

function generarApuestaMediaAjustada(ctx) {
  if (
    ctx.absDiffTotal >= 1.2 &&
    ctx.estadisticaYPsicoAlineadas &&
    !ctx.favoritoConPresion
  ) {
    const mercado =
      ctx.favoritoRol === 'local'
        ? `${ctx.favorito} gana`
        : `${ctx.favorito} gana`;

    const prob = Math.min(0.58, 0.50 + ctx.absDiffTotal * 0.04);
    const cuota = calcularCuota(prob);
    const evCalc = calcularEV(prob, cuota);

    return {
      tipo: 'media',
      mercado,
      confianza: round2(prob),
      cuota_estimada: cuota,
      EV: round3(evCalc),
      recomendada: prob >= 0.53 && evCalc >= -0.05,
      razon: `La ventaja total es clara y está respaldada por estadística y psicología. Se permite una lectura más agresiva que doble oportunidad.`,
    };
  }

  if (ctx.underdogConMomentum && ctx.absDiffTotal <= 1.2) {
    const mercado =
      ctx.underdogRol === 'local'
        ? `${ctx.underdog} gana o empata (1X)`
        : `${ctx.underdog} gana o empata (X2)`;

    const prob = 0.53;
    const cuota = calcularCuota(prob);
    const evCalc = calcularEV(prob, cuota);

    return {
      tipo: 'media',
      mercado,
      confianza: round2(prob),
      cuota_estimada: cuota,
      EV: round3(evCalc),
      recomendada: prob >= 0.52 && evCalc >= -0.05,
      razon: `El underdog muestra momentum psicológico y la diferencia total no es amplia. Se abre una lectura de doble oportunidad para el no favorito.`,
    };
  }

  if (ctx.estadisticaYPsicoContradictorias) {
    const mercado = 'Empate o partido cerrado';
    const prob = 0.54;
    const cuota = calcularCuota(prob);
    const evCalc = calcularEV(prob, cuota);

    return {
      tipo: 'media',
      mercado,
      confianza: round2(prob),
      cuota_estimada: cuota,
      EV: round3(evCalc),
      recomendada: prob >= 0.52 && evCalc >= -0.05,
      razon: `La estadística y la psicología no apuntan al mismo lado. El modelo espera un partido más disputado que dominante.`,
    };
  }

  return generarApuestaMedia(
    ctx.diffTotal,
    ctx.absDiffTotal,
    ctx.favorito,
    ctx.favoritoRol
  );
}

function generarApuestaMalcriadaAjustada(ctx) {
  if (ctx.underdogConMomentum && ctx.absDiffTotal <= 1.5) {
    const prob = 0.24;
    const cuota = 5.5;
    const evCalc = calcularEV(prob, cuota);

    return {
      tipo: 'malcriada',
      mercado: `${ctx.underdog} anota o evita goleada`,
      confianza: round2(prob),
      cuota_estimada: cuota,
      EV: round3(evCalc),
      recomendada: evCalc >= 0.20,
      razon: `La psicología detecta narrativa positiva del underdog. Es una apuesta agresiva, pero conectada al componente emocional del modelo.`,
    };
  }

  if (
    ctx.absDiffTotal >= 1.5 &&
    ctx.estadisticaYPsicoAlineadas &&
    ctx.xgTotal <= 2.4 &&
    !ctx.favoritoConPresion
  ) {
    const mercado =
      ctx.favoritoRol === 'local'
        ? `${ctx.favorito} gana 1-0 (marcador exacto)`
        : `${ctx.favorito} gana 0-1 (marcador exacto)`;

    const prob = 0.17;
    const cuota = 12.0;
    const evCalc = calcularEV(prob, cuota);

    return {
      tipo: 'malcriada',
      mercado,
      confianza: round2(prob),
      cuota_estimada: cuota,
      EV: round3(evCalc),
      recomendada: evCalc >= 0.20,
      razon: `Favorito claro, señales alineadas y xG bajo. La lectura agresiva es una victoria corta del favorito.`,
    };
  }

  return generarApuestaMalcriada(
    ctx.diffTotal,
    ctx.absDiffTotal,
    ctx.xgTotal,
    ctx.favorito,
    ctx.underdog,
    null,
    {
      local: ctx.underdogRol === 'local' && ctx.underdogConMomentum ? { underdog: true } : {},
      visitante: ctx.underdogRol === 'visitante' && ctx.underdogConMomentum ? { underdog: true } : {},
    }
  );
}

function generarApuestaSegura(xgTotal, cornersTotal, partido) {
  let mercado;
  let prob;
  let razon;

  if (xgTotal <= 2.4) {
    mercado = 'Menos de 3.5 goles';
    prob = Math.min(0.82, 0.62 + (2.4 - xgTotal) * 0.08);
    razon = `xG combinado proyectado de ${round2(xgTotal)}. Perfil de partido con margen para un under amplio.`;
  } else if (cornersTotal <= 9.5) {
    mercado = 'Menos de 10.5 córners';
    prob = Math.min(0.78, 0.58 + (9.5 - cornersTotal) * 0.04);
    razon = `Promedio combinado de corners de ${round2(cornersTotal)}. Mercado conservador de corners.`;
  } else {
    mercado = 'Más de 1.5 goles';
    prob = 0.64;
    razon = `El partido no muestra señales claras de under; se usa un mercado de goles amplio como opción conservadora.`;
  }

  const cuota = calcularCuota(prob);
  const evCalc = calcularEV(prob, cuota);
  const recomendada = prob >= 0.65 && evCalc >= -0.05;

  return {
    tipo: 'segura',
    mercado,
    confianza: round2(prob),
    cuota_estimada: cuota,
    EV: round3(evCalc),
    recomendada,
    razon: recomendada
      ? razon
      : `${razon} Sin embargo, el valor estimado no supera claramente el umbral de recomendación.`,
  };
}

function generarApuestaMedia(diff, absDiff, favorito, favoritoRol, partido) {
  let mercado;
  let prob;
  let razon;

  if (absDiff >= 0.8) {
    mercado = favoritoRol === 'local'
      ? `${favorito} gana o empata (1X)`
      : `${favorito} gana o empata (X2)`;

    prob = Math.min(0.76, 0.50 + absDiff * 0.07);
    razon = `El score total favorece a ${favorito} por ${round2(absDiff)} puntos.`;
  } else {
    mercado = 'Empate o partido cerrado';
    prob = 0.46 + Math.max(0, 0.8 - absDiff) * 0.08;
    razon = `La diferencia de score es baja (${round2(absDiff)}), por lo que el modelo detecta un partido parejo.`;
  }

  const cuota = calcularCuota(prob);
  const evCalc = calcularEV(prob, cuota);
  const recomendada = prob >= 0.52 && evCalc >= -0.05;

  return {
    tipo: 'media',
    mercado,
    confianza: round2(prob),
    cuota_estimada: cuota,
    EV: round3(evCalc),
    recomendada,
    razon: recomendada
      ? razon
      : `${razon} La señal existe, pero no es suficientemente fuerte para recomendarla como apuesta activa.`,
  };
}

function generarApuestaMalcriada(diff, absDiff, xgTotal, favorito, underdog, partido, psico) {
  let mercado;
  let prob;
  let cuota;
  let razon;

  const hayUnderdogPsico =
    psico?.local?.underdog === true || psico?.visitante?.underdog === true;

  if (absDiff >= 1.5 && xgTotal <= 2.2) {
    mercado = `${favorito} gana 1-0 (marcador exacto)`;
    prob = 0.16;
    cuota = 18.0;
    razon = `Favorito claro por score, pero con xG bajo (${round2(xgTotal)}). Perfil de victoria mínima.`;
  } else if (hayUnderdogPsico) {
    mercado = `${underdog} anota o evita goleada`;
    prob = 0.22;
    cuota = 5.5;
    razon = `El componente psicológico detecta narrativa de underdog competitivo.`;
  } else {
    mercado = 'Empate 1-1';
    prob = 0.14;
    cuota = 7.5;
    razon = `Partido sin señal extrema. Se propone marcador plausible de riesgo alto, no necesariamente recomendado.`;
  }

  const evCalc = calcularEV(prob, cuota);
  const recomendada = evCalc >= 0.20;

  return {
    tipo: 'malcriada',
    mercado,
    confianza: round2(prob),
    cuota_estimada: cuota,
    EV: round3(evCalc),
    recomendada,
    razon: recomendada
      ? razon
      : `${razon} El EV no alcanza el umbral para recomendarla activamente.`,
  };
}

function calcularCuota(prob) {
  if (prob <= 0 || prob >= 1) return 1.0;
  const cuotaJusta = 1 / prob;
  const margen = 0.05;
  return round2(cuotaJusta * (1 - margen));
}

function calcularEV(prob, cuota) {
  return (prob * cuota) - 1;
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
