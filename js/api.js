import { CONFIG, EQUIPOS_FLAGS } from './config.js';

export async function getPartidosMundial() {
  try {
    const res = await fetch("https://us-central1-predictor-mundial-2026-cfbfe.cloudfunctions.net/getMatches");

    if (!res.ok) {
      throw new Error(`Firebase Function getMatches: ${res.status}`);
    }

    const data = await res.json();
    return data.matches || [];
  } catch (e) {
    console.error('Error cargando partidos desde API. Usando fallback local:', e);

    try {
      const localRes = await fetch("data/partidos.json");
      const localData = await localRes.json();
      return localData || [];
    } catch (fallbackError) {
      console.error('Error cargando partidos locales:', fallbackError);
      return [];
    }
  }
}

export async function getStatsEquipo(equipoId, equipoNombre) {
  let statsBase = null;

  try {
    const statsPremundial = await getStatsEquipoPremundial(equipoId, equipoNombre);

    if (statsPremundial && Number(statsPremundial.partidos_analizados || 0) > 0) {
      statsBase = statsPremundial;

      console.log(`Usando stats premundial para ${equipoNombre}`, {
        partidos: statsPremundial.partidos_analizados,
        fuente: statsPremundial.fuente,
        statsPremundial,
      });
    }
  } catch (e) {
    console.warn(`No se pudo cargar premundial para ${equipoNombre}`, e);
  }

  if (!statsBase) {
    try {
      statsBase = await getStatsEquipoFootballData(equipoId, equipoNombre);
    } catch (e) {
      console.warn(`No se pudo usar football-data para ${equipoNombre}. Usando default.`, e);
      statsBase = getStatsDefault(equipoNombre);
    }
  }

  try {
    const statsFotmob = await getStatsEquipoFotmob(equipoNombre);

    if (statsFotmob && Number(statsFotmob.partidos_analizados || 0) > 0) {
      const pesoFotmob = calcularPesoFotmob(statsFotmob.partidos_analizados);
      const statsCombinadas = mezclarStatsEquipo(statsBase, statsFotmob, pesoFotmob);

      console.log(`Usando stats combinadas para ${equipoNombre}`, {
        pesoFotmob,
        base: statsBase?.fuente,
        fotmob: statsFotmob?.fuente,
        statsCombinadas,
      });

      return statsCombinadas;
    }

    return statsBase;
  } catch (e) {
    console.warn(`No se pudo usar FotMob para ${equipoNombre}. Usando base.`, e);
    return statsBase;
  }
}

async function getStatsEquipoFootballData(equipoId, equipoNombre) {
  try {
    if (!equipoId) return getStatsDefault(equipoNombre);

    const url = new URL(
      "https://us-central1-predictor-mundial-2026-cfbfe.cloudfunctions.net/getTeamStats"
    );

    url.searchParams.set("equipoId", equipoId);
    url.searchParams.set("equipoNombre", equipoNombre || "Equipo");

    const res = await fetch(url.toString());

    if (!res.ok) {
      throw new Error(`Firebase Function getTeamStats: ${res.status}`);
    }

    return await res.json();
  } catch (e) {
    console.error(`Error stats football-data ${equipoNombre}:`, e);
    return getStatsDefault(equipoNombre);
  }
}

async function getFotmobTeamId(equipoNombre) {
  try {
    const res = await fetch("data/fotmob-teams.json");

    if (!res.ok) return null;

    const mapa = await res.json();

    return (
      mapa[equipoNombre] ||
      mapa[normalizarNombreEquipoApi(equipoNombre)] ||
      null
    );
  } catch (e) {
    console.warn("No se pudo leer data/fotmob-teams.json", e);
    return null;
  }
}

function normalizarNombreEquipoApi(nombre) {
  return String(nombre || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

async function getStatsEquipoPremundial(equipoId, equipoNombre) {
  try {
    const fotmobTeamId = await getFotmobTeamId(equipoNombre);

    const idPremundial = fotmobTeamId || equipoId;

    if (!idPremundial) return null;

    const url = new URL(
      "https://us-central1-predictor-mundial-2026-cfbfe.cloudfunctions.net/getTeamStatsPremundial"
    );

    url.searchParams.set("equipoId", idPremundial);
    url.searchParams.set("equipoNombre", equipoNombre || "Equipo");

    const res = await fetch(url.toString());

    if (!res.ok) {
      throw new Error(`Firebase Function getTeamStatsPremundial: ${res.status}`);
    }

    const data = await res.json();

    if (data && Number(data.partidos_analizados || 0) > 0) {
      console.log(`Stats premundial encontradas para ${equipoNombre}`, {
        equipoIdOriginal: equipoId,
        fotmobTeamId,
        fuente: data.fuente,
        partidos: data.partidos_analizados,
      });
    }

    return data;
  } catch (e) {
    console.warn(`No se pudo usar stats premundial para ${equipoNombre}`, e);
    return null;
  }
}

async function getStatsEquipoFotmob(equipoNombre) {
  if (!equipoNombre) return null;

  const url = new URL(
    "https://us-central1-predictor-mundial-2026-cfbfe.cloudfunctions.net/getTeamStatsFotmob"
  );

  url.searchParams.set("equipoNombre", equipoNombre);

  const res = await fetch(url.toString());

  if (!res.ok) {
    throw new Error(`Firebase Function getTeamStatsFotmob: ${res.status}`);
  }

  return await res.json();
}

function calcularPesoFotmob(partidosAnalizados) {
  const n = Number(partidosAnalizados || 0);

  if (n <= 0) return 0;
  if (n === 1) return 0.30;
  if (n === 2) return 0.50;
  if (n === 3) return 0.70;

  return 0.85;
}

function mezclarStatsEquipo(base, fotmob, pesoFotmob) {
  const pesoBase = 1 - pesoFotmob;

  return {
    xg_promedio: mix(base.xg_promedio, fotmob.xg_promedio, pesoBase, pesoFotmob),
    xg_concedido_promedio: mix(base.xg_concedido_promedio, fotmob.xg_concedido_promedio, pesoBase, pesoFotmob),

    forma: combinarForma(base.forma, fotmob.forma),
    puntos_ultimos7: Math.round(mix(base.puntos_ultimos7, fotmob.puntos_ultimos7, pesoBase, pesoFotmob)),

    goles_promedio: mix(base.goles_promedio, fotmob.goles_promedio, pesoBase, pesoFotmob),
    goles_concedidos_promedio: mix(base.goles_concedidos_promedio, fotmob.goles_concedidos_promedio, pesoBase, pesoFotmob),

    corners_promedio: mix(base.corners_promedio, fotmob.corners_promedio, pesoBase, pesoFotmob),
    tiros_promedio: mix(base.tiros_promedio, fotmob.tiros_promedio, pesoBase, pesoFotmob),
    tiros_puerta_promedio: mix(base.tiros_puerta_promedio, fotmob.tiros_puerta_promedio, pesoBase, pesoFotmob),

    amarillas_promedio: mix(base.amarillas_promedio, fotmob.amarillas_promedio, pesoBase, pesoFotmob),

    h2h_victorias: mix(base.h2h_victorias, fotmob.h2h_victorias, pesoBase, pesoFotmob),

    lesiones_impacto: base.lesiones_impacto ?? fotmob.lesiones_impacto ?? 0,

    partidos_analizados:
      Number(base.partidos_analizados || 0) + Number(fotmob.partidos_analizados || 0),

    fuente: `mixta_${Math.round(pesoFotmob * 100)}pct_fotmob`,
    fuente_base: base.fuente || "base",
    fuente_fotmob: fotmob.fuente || "fotmob",
  };
}

function mix(baseVal, fotmobVal, pesoBase, pesoFotmob) {
  const b = Number(baseVal);
  const f = Number(fotmobVal);

  if (Number.isNaN(b) && Number.isNaN(f)) return null;
  if (Number.isNaN(b)) return redondear(f, 2);
  if (Number.isNaN(f)) return redondear(b, 2);

  return redondear((b * pesoBase) + (f * pesoFotmob), 2);
}

function combinarForma(baseForma, fotmobForma) {
  const f = `${fotmobForma || ""}${baseForma || ""}`;
  return f.slice(0, 5) || "WDWDW";
}

function redondear(valor, decimales = 2) {
  const n = Number(valor);
  if (Number.isNaN(n)) return null;

  const factor = Math.pow(10, decimales);
  return Math.round(n * factor) / factor;
}

function getStatsDefault(equipoNombre) {
  return {
    xg_promedio: 1.2,
    forma: 'WDWDW',
    puntos_ultimos7: 10,
    goles_promedio: 1.3,
    goles_concedidos_promedio: 1.0,
    corners_promedio: 4.5,
    h2h_victorias: 0.40,
    lesiones_impacto: 0,
    partidos_analizados: 0,
    fuente: 'estimado',
  };
}

export async function consultarAnalisisPsicologico(partido, generar = false) {
  const jornada = inferirJornadaApi(partido);

  const res = await fetch("https://us-central1-predictor-mundial-2026-cfbfe.cloudfunctions.net/analyzePsychology", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      partidoId: partido.id.toString(),
      equipoLocal: partido.homeTeam?.name,
      equipoVisitante: partido.awayTeam?.name,
      jornada,
      grupo: partido.group || "Grupos",
      fecha: new Date(partido.utcDate).toLocaleDateString("es-PE"),
      fechaPartido: partido.utcDate,
      generar,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Firebase Function analyzePsychology: ${res.status} ${errorText}`);
  }

  const data = await res.json();

  if (data.estado === "completo" && data.psicologico) {
    return data;
  }

  return {
    ...data,
    psicologico: data.psicologico || getPsicoDefault(),
  };
}

export function getPsicoDefault() {
  return {
    local: {
      necesita_ganar: false,
      venganza_narrativa: false,
      rival_maldito: 0,
      presion_mediatica: 3,
      lider_disponible: true,
      nombre_lider: "",
      conflicto_interno: 0,
      generacion_peak: false,
      underdog: false,
      clasifico_sufriendo: "comodo",
      humillacion_previa: false,
    },
    visitante: {
      necesita_ganar: false,
      venganza_narrativa: false,
      rival_maldito: 0,
      presion_mediatica: 2,
      lider_disponible: true,
      nombre_lider: "",
      conflicto_interno: 0,
      generacion_peak: false,
      underdog: false,
      clasifico_sufriendo: "comodo",
      humillacion_previa: false,
    },
    narrativa: "Análisis IA pendiente. Se usaron valores psicológicos por defecto.",
    lesiones_destacadas: [],
    fuentes: [],
  };
}

function inferirJornadaApi(partido) {
  const date = new Date(partido.utcDate);
  const inicio = new Date("2026-06-11");
  const dias = Math.floor((date - inicio) / (1000 * 60 * 60 * 24));

  if (dias < 8) return 1;
  if (dias < 16) return 2;
  return 3;
}

export function getFlag(nombreEquipo) {
  return EQUIPOS_FLAGS[nombreEquipo] || '🏳';
}

export function formatearFecha(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function getRankingEquipo(nombreEquipo) {
  try {
    const res = await fetch("data/rankings.json");
    const rankings = await res.json();

    return rankings[nombreEquipo] || 48;
  } catch (e) {
    console.error("Error cargando ranking:", e);
    return 48;
  }
}