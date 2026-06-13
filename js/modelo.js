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
  const expectativa = Math.min(1, (rankingFIFA || 24) / 48);
  const factorBase = expectativa;

  if (jornada === 1) return 1.0 + (0.10 * factorBase);
  if (jornada === 2) return 1.0 + (0.05 * factorBase);
  if (jornada === 3) return 1.0;
  return 1.0 + (0.03 * factorBase);
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
  const diff = totalLocal - totalVisitante;
  const absDiff = Math.abs(diff);

  const xgTotal = (statsLocal?.xg_promedio || 1.2) + (statsVisitante?.xg_promedio || 1.2);
  const cornersTotal = (statsLocal?.corners_promedio || 4.5) + (statsVisitante?.corners_promedio || 4.5);

  const favorito = diff >= 0 ? partido.nombreLocal : partido.nombreVisitante;
  const favoritoRol = diff >= 0 ? 'local' : 'visitante';

  const underdog = diff >= 0 ? partido.nombreVisitante : partido.nombreLocal;

  const segura = generarApuestaSegura(xgTotal, cornersTotal, partido);
  const media = generarApuestaMedia(diff, absDiff, favorito, favoritoRol, partido);
  const malcriada = generarApuestaMalcriada(diff, absDiff, xgTotal, favorito, underdog, partido, psico);

  return [segura, media, malcriada];
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
