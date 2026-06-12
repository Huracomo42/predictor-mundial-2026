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
    console.error(`Error stats ${equipoNombre}:`, e);
    return getStatsDefault(equipoNombre);
  }
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