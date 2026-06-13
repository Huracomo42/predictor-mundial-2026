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

  const favorito = diffTotal >= 0 ? partido.nombreLocal : partido.nombreVisitante;
  const underdog = diffTotal >= 0 ? partido.nombreVisitante : partido.nombreLocal;
  const favoritoRol = diffTotal >= 0 ? 'local' : 'visitante';
  const underdogRol = diffTotal >= 0 ? 'visitante' : 'local';

  const statsFavorito = favoritoRol === 'local' ? statsLocal : statsVisitante;
  const statsUnderdog = underdogRol === 'local' ? statsLocal : statsVisitante;

  const xgLocal = Number(statsLocal?.xg_promedio ?? statsLocal?.goles_promedio ?? 1.2);
  const xgVisitante = Number(statsVisitante?.xg_promedio ?? statsVisitante?.goles_promedio ?? 1.2);
  const xgTotal = xgLocal + xgVisitante;

  const golesLocal = Number(statsLocal?.goles_promedio || 1.2);
  const golesVisitante = Number(statsVisitante?.goles_promedio || 1.2);
  const golesTotal = golesLocal + golesVisitante;

  const concedidosLocal = Number(statsLocal?.goles_concedidos_promedio || 1.2);
  const concedidosVisitante = Number(statsVisitante?.goles_concedidos_promedio || 1.2);

  const cornersLocal = Number(statsLocal?.corners_promedio || 4.5);
  const cornersVisitante = Number(statsVisitante?.corners_promedio || 4.5);
  const cornersTotal = cornersLocal + cornersVisitante;

  const tirosPuertaLocal = Number(statsLocal?.tiros_puerta_promedio || 0);
  const tirosPuertaVisitante = Number(statsVisitante?.tiros_puerta_promedio || 0);

  const amarillasLocal = Number(statsLocal?.amarillas_promedio || 0);
  const amarillasVisitante = Number(statsVisitante?.amarillas_promedio || 0);
  const amarillasTotal = amarillasLocal + amarillasVisitante;

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

    xgLocal,
    xgVisitante,
    xgTotal,
    golesLocal,
    golesVisitante,
    golesTotal,
    concedidosLocal,
    concedidosVisitante,

    cornersLocal,
    cornersVisitante,
    cornersTotal,

    tirosPuertaLocal,
    tirosPuertaVisitante,

    amarillasLocal,
    amarillasVisitante,
    amarillasTotal,

    favorito,
    underdog,
    favoritoRol,
    underdogRol,
    statsFavorito,
    statsUnderdog,

    estadisticaYPsicoAlineadas,
    estadisticaYPsicoContradictorias,
    favoritoConPresion,
    underdogConMomentum,
    boostFavoreceFavorito,
  };

  console.log('Contexto apuestas', contexto);

  const candidatos = generarMercadosCandidatos(contexto);
  const rankeados = rankearMercados(candidatos);

  return seleccionarApuestas(rankeados);
}

function generarMercadosCandidatos(ctx) {
  const candidatos = [];

  agregarMercado(candidatos, mercadoGanadorFavorito(ctx));
  agregarMercado(candidatos, mercadoDobleOportunidadFavorito(ctx));
  agregarMercado(candidatos, mercadoHandicapUnderdog(ctx));
  agregarMercado(candidatos, mercadoOver15Goles(ctx));
  agregarMercado(candidatos, mercadoUnder35Goles(ctx));
  agregarMercado(candidatos, mercadoAmbosAnotan(ctx));
  agregarMercado(candidatos, mercadoEquipoFavoritoMas15Goles(ctx));
  agregarMercado(candidatos, mercadoEquipoUnderdogAnota(ctx));
  agregarMercado(candidatos, mercadoCornersOver(ctx));
  agregarMercado(candidatos, mercadoTirosPuertaFavorito(ctx));
  agregarMercado(candidatos, mercadoTarjetasOver(ctx));
  agregarMercado(candidatos, mercadoPartidoCerrado(ctx));
  agregarMercado(candidatos, mercadoMarcadorExacto(ctx));

  return candidatos;
}

function mercadoGanadorFavorito(ctx) {
  if (ctx.absDiffTotal < 1.0) return null;

  const ataqueFavorito = Number(ctx.statsFavorito?.goles_promedio || 1.2);
  const defensaUnderdog = Number(ctx.statsUnderdog?.goles_concedidos_promedio || 1.2);

  let prob = 0.48 + ctx.absDiffTotal * 0.045;

  if (ctx.estadisticaYPsicoAlineadas) prob += 0.04;
  if (ataqueFavorito >= 1.8) prob += 0.03;
  if (defensaUnderdog >= 1.4) prob += 0.03;
  if (ctx.favoritoConPresion) prob -= 0.05;

  return {
    mercado: `${ctx.favorito} gana`,
    confianza: prob,
    riesgo: 'medio',
    razon: `El score total favorece a ${ctx.favorito} por ${round2(ctx.absDiffTotal)} puntos. La lectura permite ganador directo si la cuota acompaña.`,
  };
}

function mercadoDobleOportunidadFavorito(ctx) {
  if (ctx.absDiffTotal < 0.5) return null;
  if (ctx.absDiffTotal >= 1.8) return null;

  let prob = 0.58 + ctx.absDiffTotal * 0.06;

  if (ctx.favoritoConPresion) prob -= 0.04;
  if (ctx.estadisticaYPsicoAlineadas) prob += 0.03;

  const mercado =
    ctx.favoritoRol === 'local'
      ? `${ctx.favorito} gana o empata (1X)`
      : `${ctx.favorito} gana o empata (X2)`;

  return {
    mercado,
    confianza: prob,
    riesgo: 'bajo',
    razon: `Ventaja moderada para ${ctx.favorito}. La doble oportunidad aparece solo como cobertura cuando el favoritismo no es aplastante.`,
  };
}

function mercadoHandicapUnderdog(ctx) {
  if (ctx.absDiffTotal > 1.4) return null;

  let prob = 0.57;

  if (ctx.underdogConMomentum) prob += 0.05;
  if (ctx.estadisticaYPsicoContradictorias) prob += 0.04;
  if (ctx.xgTotal <= 2.5) prob += 0.03;

  return {
    mercado: `${ctx.underdog} +1.5 hándicap`,
    confianza: prob,
    riesgo: 'bajo',
    razon: `La diferencia no es amplia y el perfil del partido no sugiere goleada. Se protege al underdog con hándicap positivo.`,
  };
}

function mercadoOver15Goles(ctx) {
  const ataqueTotal = ctx.golesLocal + ctx.golesVisitante;
  const defensasVulnerables = ctx.concedidosLocal + ctx.concedidosVisitante;

  if (ataqueTotal < 2.2 && ctx.xgTotal < 2.0) return null;

  let prob = 0.58;

  if (ataqueTotal >= 2.8) prob += 0.06;
  if (ctx.xgTotal >= 2.2) prob += 0.05;
  if (defensasVulnerables >= 2.2) prob += 0.04;

  return {
    mercado: 'Más de 1.5 goles',
    confianza: prob,
    riesgo: 'bajo',
    razon: `Los promedios ofensivos y de xG sugieren un partido con al menos dos goles como escenario razonable.`,
  };
}

function mercadoUnder35Goles(ctx) {
  const defensasSolidas =
    ctx.concedidosLocal <= 1.1 &&
    ctx.concedidosVisitante <= 1.1;

  const xgModerado = ctx.xgTotal <= 2.7;
  const golesModerados = ctx.golesTotal <= 2.8;
  const partidoParejo = ctx.absDiffTotal <= 1.2;

  // El Under 3.5 solo debe salir si hay señal clara de partido controlado.
  if (!xgModerado && !defensasSolidas && !partidoParejo) return null;

  let prob = 0.58;

  if (xgModerado) prob += 0.06;
  if (golesModerados) prob += 0.04;
  if (defensasSolidas) prob += 0.05;
  if (ctx.estadisticaYPsicoContradictorias) prob += 0.03;

  return {
    mercado: 'Menos de 3.5 goles',
    confianza: prob,
    riesgo: 'bajo',
    razon: `El perfil combinado apunta a partido controlado: xG total ${round2(ctx.xgTotal)}, goles promedio ${round2(ctx.golesTotal)} y defensas relativamente contenidas.`,
  };
}

function mercadoAmbosAnotan(ctx) {
  if (ctx.golesLocal < 1.1 || ctx.golesVisitante < 1.1) return null;

  let prob = 0.46;

  if (ctx.golesLocal >= 1.5 && ctx.golesVisitante >= 1.5) prob += 0.08;
  if (ctx.concedidosLocal >= 1.0 && ctx.concedidosVisitante >= 1.0) prob += 0.06;
  if (ctx.xgLocal >= 1.0 && ctx.xgVisitante >= 1.0) prob += 0.04;

  return {
    mercado: 'Ambos equipos anotan',
    confianza: prob,
    riesgo: 'medio',
    razon: `Ambos equipos tienen señales ofensivas suficientes y conceden oportunidades. Mercado de goles con riesgo medio.`,
  };
}

function mercadoEquipoFavoritoMas15Goles(ctx) {
  const ataqueFavorito = Number(ctx.statsFavorito?.goles_promedio || 0);
  const concedeUnderdog = Number(ctx.statsUnderdog?.goles_concedidos_promedio || 0);

  if (ataqueFavorito < 1.7 && concedeUnderdog < 1.3) return null;

  let prob = 0.45;

  if (ataqueFavorito >= 2.0) prob += 0.08;
  if (concedeUnderdog >= 1.4) prob += 0.07;
  if (ctx.absDiffTotal >= 1.2) prob += 0.04;

  return {
    mercado: `${ctx.favorito} más de 1.5 goles`,
    confianza: prob,
    riesgo: 'medio',
    razon: `${ctx.favorito} combina ventaja de score con capacidad ofensiva reciente. Se explora mercado de goles del equipo.`,
  };
}

function mercadoEquipoUnderdogAnota(ctx) {
  const ataqueUnderdog = Number(ctx.statsUnderdog?.goles_promedio || 0);
  const concedeFavorito = Number(ctx.statsFavorito?.goles_concedidos_promedio || 0);

  if (ataqueUnderdog < 1.0 && !ctx.underdogConMomentum) return null;

  let prob = 0.36;

  if (ataqueUnderdog >= 1.4) prob += 0.06;
  if (concedeFavorito >= 1.0) prob += 0.05;
  if (ctx.underdogConMomentum) prob += 0.06;

  return {
    mercado: `${ctx.underdog} anota`,
    confianza: prob,
    cuota_estimada: 2.8,
    riesgo: 'alto',
    razon: `El underdog muestra señales ofensivas o momentum psicológico. Es una lectura agresiva, no conservadora.`,
  };
}

function mercadoCornersOver(ctx) {
  if (!ctx.cornersTotal || ctx.cornersTotal < 8.0) return null;

  let prob = 0.52;

  if (ctx.cornersTotal >= 9.5) prob += 0.07;
  if (ctx.cornersTotal >= 10.5) prob += 0.04;

  return {
    mercado: 'Más de 8.5 córners',
    confianza: prob,
    riesgo: prob >= 0.60 ? 'bajo' : 'medio',
    razon: `El promedio combinado de córners es ${round2(ctx.cornersTotal)}. El partido proyecta volumen por bandas o ataques frecuentes.`,
  };
}

function mercadoTirosPuertaFavorito(ctx) {
  const tirosPuertaFavorito =
    ctx.favoritoRol === 'local'
      ? ctx.tirosPuertaLocal
      : ctx.tirosPuertaVisitante;

  if (!tirosPuertaFavorito || tirosPuertaFavorito < 4.2) return null;

  let prob = 0.50;

  if (tirosPuertaFavorito >= 5.0) prob += 0.08;
  if (ctx.absDiffTotal >= 1.0) prob += 0.04;

  return {
    mercado: `${ctx.favorito} más de 4.5 tiros al arco`,
    confianza: prob,
    riesgo: 'medio',
    razon: `${ctx.favorito} tiene promedio alto de tiros al arco y ventaja global en el modelo.`,
  };
}

function mercadoTarjetasOver(ctx) {
  if (!ctx.amarillasTotal || ctx.amarillasTotal < 2.0) return null;

  let prob = 0.50;

  if (ctx.amarillasTotal >= 3.0) prob += 0.07;
  if (ctx.estadisticaYPsicoContradictorias) prob += 0.04;

  return {
    mercado: 'Más de 2.5 tarjetas',
    confianza: prob,
    riesgo: 'medio',
    razon: `El promedio combinado de amarillas es ${round2(ctx.amarillasTotal)}. Puede haber fricción competitiva.`,
  };
}

function mercadoPartidoCerrado(ctx) {
  if (ctx.absDiffTotal > 0.8) return null;

  let prob = 0.50;

  if (ctx.xgTotal <= 2.5) prob += 0.05;
  if (ctx.estadisticaYPsicoContradictorias) prob += 0.05;

  return {
    mercado: 'Empate o partido cerrado',
    confianza: prob,
    riesgo: 'medio',
    razon: `La diferencia total es baja (${round2(ctx.absDiffTotal)}). El modelo espera un partido de márgenes cortos.`,
  };
}

function mercadoMarcadorExacto(ctx) {
  if (ctx.xgTotal <= 2.4 && ctx.absDiffTotal >= 1.0) {
    return {
      mercado:
        ctx.favoritoRol === 'local'
          ? `${ctx.favorito} gana 1-0 (marcador exacto)`
          : `${ctx.favorito} gana 0-1 (marcador exacto)`,
      confianza: 0.16,
      cuota_estimada: 12.0,
      riesgo: 'alto',
      razon: `Favorito con ventaja, pero partido de xG bajo. Se propone victoria corta como lectura de alto riesgo.`,
    };
  }

  return {
    mercado: 'Empate 1-1',
    confianza: 0.14,
    cuota_estimada: 7.5,
    riesgo: 'alto',
    razon: `Marcador plausible de riesgo alto cuando no hay señal extrema de goleada.`,
  };
}

function agregarMercado(candidatos, mercado) {
  if (!mercado) return;
  if (!mercado.mercado) return;

  const prob = Math.max(0.01, Math.min(0.95, Number(mercado.confianza || 0.5)));
  const cuota = mercado.cuota_estimada || calcularCuota(prob);
  const evCalc = calcularEV(prob, cuota);

  candidatos.push({
    ...mercado,
    confianza: round2(prob),
    cuota_estimada: cuota,
    EV: round3(evCalc),
    recomendada: mercado.recomendada ?? evCalc >= 0.02,
  });
}

function rankearMercados(candidatos) {
  return candidatos
    .filter(Boolean)
    .sort((a, b) => {
      const scoreA = scoreMercado(a);
      const scoreB = scoreMercado(b);
      return scoreB - scoreA;
    });
}

function scoreMercado(ap) {
  const confianza = Number(ap.confianza || 0);
  const ev = Number(ap.EV || 0);
  const riesgoPenalty =
    ap.riesgo === 'bajo' ? 0.05 :
    ap.riesgo === 'medio' ? 0 :
    -0.08;

  return confianza + ev * 0.35 + riesgoPenalty;
}

function seleccionarApuestas(candidatos) {
  const usadas = new Set();
  const gruposUsados = new Set();

  const segura = elegirPorTipo(candidatos, 'segura', usadas, gruposUsados);
  const media = elegirPorTipo(candidatos, 'media', usadas, gruposUsados);
  const malcriada = elegirPorTipo(candidatos, 'malcriada', usadas, gruposUsados);

  return [segura, media, malcriada].filter(Boolean);
}

function elegirPorTipo(candidatos, tipo, usadas, gruposUsados) {
  const filtrados = candidatos.filter((ap) => {
    if (usadas.has(ap.mercado)) return false;

    const grupo = grupoMercado(ap.mercado);

    // Evita repetir mercados del mismo grupo.
    // Ejemplo: no mostrar "Más de 1.5 goles" y "Menos de 3.5 goles" juntos.
    if (gruposUsados.has(grupo)) return false;

    if (tipo === 'segura') {
      return ap.confianza >= 0.62 && ap.riesgo === 'bajo';
    }

    if (tipo === 'media') {
      return ap.confianza >= 0.42 && ap.confianza < 0.68 && ap.riesgo !== 'alto';
    }

    if (tipo === 'malcriada') {
      return ap.riesgo === 'alto' || ap.cuota_estimada >= 4.5;
    }

    return false;
  });

  const elegido = filtrados[0];

  if (!elegido) return null;

  usadas.add(elegido.mercado);
  gruposUsados.add(grupoMercado(elegido.mercado));

  return {
    ...elegido,
    tipo,
  };
}

function grupoMercado(mercado) {
  const m = String(mercado || '').toLowerCase();

  if (
    m.includes('más de 1.5 goles') ||
    m.includes('menos de 3.5 goles') ||
    m.includes('total de goles') ||
    m.includes('ambos equipos anotan')
  ) {
    return 'goles_totales';
  }

  if (
    m.includes('gana') ||
    m.includes('empata') ||
    m.includes('doble oportunidad') ||
    m.includes('hándicap') ||
    m.includes('handicap')
  ) {
    return 'resultado';
  }

  if (m.includes('córner') || m.includes('corner')) {
    return 'corners';
  }

  if (m.includes('tiros') || m.includes('arco')) {
    return 'tiros';
  }

  if (m.includes('tarjeta') || m.includes('amarilla')) {
    return 'tarjetas';
  }

  if (m.includes('marcador exacto') || m.includes('1-0') || m.includes('0-1') || m.includes('1-1')) {
    return 'marcador_exacto';
  }

  if (m.includes('anota')) {
    return 'equipo_anota';
  }

  return 'otros';
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
