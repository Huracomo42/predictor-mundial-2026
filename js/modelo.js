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

  const apuestas = generarApuestas(totalLocal, totalVisitante, statsLocal, statsVisitante, datosPartido, psicologico);

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

function generarApuestas(totalLocal, totalVisitante, statsLocal, statsVisitante, partido, psico) {
  const apuestas = [];
  const diff = totalLocal - totalVisitante;
  const xgTotal = (statsLocal?.xg_promedio || 1.2) + (statsVisitante?.xg_promedio || 0.9);
  const cornersTotal = (statsLocal?.corners_promedio || 4.5) + (statsVisitante?.corners_promedio || 4.0);

  if (xgTotal < 2.1) {
    const probUnder = Math.min(0.92, 0.55 + (2.1 - xgTotal) * 0.15);
    const cuota = calcularCuota(probUnder);
    const evCalc = calcularEV(probUnder, cuota);
    if (evCalc > -0.05) {
      apuestas.push({
        tipo: 'segura',
        mercado: 'Menos de 2.5 goles',
        confianza: round2(probUnder),
        cuota_estimada: cuota,
        EV: round3(evCalc),
        razon: `xG combinado proyectado de ${round2(xgTotal)} — perfil de partido cerrado. Ambos equipos en modo debut.`,
      });
    }
  }

  if (cornersTotal < 8.5) {
    const probCorners = Math.min(0.88, 0.50 + (8.5 - cornersTotal) * 0.05);
    const cuota = calcularCuota(probCorners);
    const evCalc = calcularEV(probCorners, cuota);
    if (evCalc > -0.05) {
      apuestas.push({
        tipo: 'segura',
        mercado: 'Menos de 9.5 córners',
        confianza: round2(probCorners),
        cuota_estimada: cuota,
        EV: round3(evCalc),
        razon: `Promedio combinado de corners: ${round2(cornersTotal)}. Jornada ${partido.jornada} históricamente genera menos corners.`,
      });
    }
  }

  if (diff > 0.8) {
    const probGana = Math.min(0.78, 0.45 + diff * 0.06);
    const cuota = calcularCuota(probGana);
    const evCalc = calcularEV(probGana, cuota);
    if (evCalc > -0.05) {
      apuestas.push({
        tipo: 'media',
        mercado: `${partido.nombreLocal} gana o empata (1X)`,
        confianza: round2(probGana),
        cuota_estimada: cuota,
        EV: round3(evCalc),
        razon: `Score total local ${round2(totalLocal)} vs ${round2(totalVisitante)} visitante. Ventaja de ${round2(diff)} puntos.`,
      });
    }
  } else if (diff < -0.8) {
    const probGana = Math.min(0.78, 0.45 + Math.abs(diff) * 0.06);
    const cuota = calcularCuota(probGana);
    const evCalc = calcularEV(probGana, cuota);
    if (evCalc > -0.05) {
      apuestas.push({
        tipo: 'media',
        mercado: `${partido.nombreVisitante} gana o empata (X2)`,
        confianza: round2(probGana),
        cuota_estimada: cuota,
        EV: round3(evCalc),
        razon: `Score visitante ${round2(totalVisitante)} supera al local ${round2(totalLocal)}. Ventaja de ${round2(Math.abs(diff))} puntos.`,
      });
    }
  }

  if (psico?.visitante?.underdog && !psico?.visitante?.lider_disponible === false) {
    const probAmarillas = 0.72;
    const cuota = 1.55;
    const evCalc = calcularEV(probAmarillas, cuota);
    if (evCalc > 0) {
      apuestas.push({
        tipo: 'media',
        mercado: `${partido.nombreVisitante} +1.5 tarjetas amarillas`,
        confianza: round2(probAmarillas),
        cuota_estimada: cuota,
        EV: round3(evCalc),
        razon: 'Visitante con perfil físico + presión de debut. Histórico de faltas tácticas en partidos de alta presión.',
      });
    }
  }

  if (Math.abs(diff) > 1.5 && xgTotal < 1.8) {
    const favorito = diff > 0 ? partido.nombreLocal : partido.nombreVisitante;
    const probExacto = 0.18;
    const cuota = 20.0;
    const evCalc = calcularEV(probExacto, cuota);
    if (evCalc > 0.5) {
      apuestas.push({
        tipo: 'malcriada',
        mercado: `${favorito} gana 1-0 (marcador exacto)`,
        confianza: round2(probExacto),
        cuota_estimada: cuota,
        EV: round3(evCalc),
        razon: `Diferencia de score de ${round2(Math.abs(diff))} con xG bajo (${round2(xgTotal)}). Perfil de victoria mínima. EV positivo a cuota ~20.`,
      });
    }
  }

  return apuestas.sort((a, b) => {
    const orden = { segura: 0, media: 1, malcriada: 2 };
    return orden[a.tipo] - orden[b.tipo];
  });
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
