import { CONFIG, EQUIPOS_FLAGS } from './config.js';

export async function getPartidosMundial() {
  try {
    const res = await fetch(
      `${CONFIG.FOOTBALL_DATA_BASE}/competitions/${CONFIG.WC_COMPETITION_ID}/matches?status=SCHEDULED,LIVE,FINISHED`,
      { headers: { 'X-Auth-Token': CONFIG.FOOTBALL_DATA_TOKEN } }
    );
    if (!res.ok) throw new Error(`football-data.org: ${res.status}`);
    const data = await res.json();
    return data.matches || [];
  } catch (e) {
    console.error('Error cargando partidos:', e);
    return [];
  }
}

export async function getStatsEquipo(equipoId, equipoNombre) {
  try {
    const res = await fetch(
      `${CONFIG.FOOTBALL_DATA_BASE}/teams/${equipoId}/matches?limit=10&competitions=${CONFIG.WC_COMPETITION_ID}`,
      { headers: { 'X-Auth-Token': CONFIG.FOOTBALL_DATA_TOKEN } }
    );

    let partidos = [];
    if (res.ok) {
      const data = await res.json();
      partidos = data.matches || [];
    }

    const resGeneral = await fetch(
      `${CONFIG.FOOTBALL_DATA_BASE}/teams/${equipoId}/matches?limit=10`,
      { headers: { 'X-Auth-Token': CONFIG.FOOTBALL_DATA_TOKEN } }
    );

    let partidos_general = [];
    if (resGeneral.ok) {
      const data = await resGeneral.json();
      partidos_general = data.matches || [];
    }

    const todosPartidos = [...new Map(
      [...partidos, ...partidos_general].map(p => [p.id, p])
    ).values()].slice(0, 10);

    return procesarStatsPartidos(todosPartidos, equipoId, equipoNombre);
  } catch (e) {
    console.error(`Error stats ${equipoNombre}:`, e);
    return getStatsDefault(equipoNombre);
  }
}

function procesarStatsPartidos(partidos, equipoId, equipoNombre) {
  if (!partidos || partidos.length === 0) return getStatsDefault(equipoNombre);

  const terminados = partidos.filter(p => p.status === 'FINISHED');
  if (terminados.length === 0) return getStatsDefault(equipoNombre);

  let puntos = 0;
  let golesAFavor = 0;
  let golesEnContra = 0;
  let victorias = 0;
  let derrotas = 0;

  terminados.forEach(p => {
    const esLocal = p.homeTeam?.id === equipoId;
    const gF = esLocal ? (p.score?.fullTime?.home || 0) : (p.score?.fullTime?.away || 0);
    const gC = esLocal ? (p.score?.fullTime?.away || 0) : (p.score?.fullTime?.home || 0);
    golesAFavor += gF;
    golesEnContra += gC;
    if (gF > gC) { puntos += 3; victorias++; }
    else if (gF === gC) puntos += 1;
    else derrotas++;
  });

  const n = terminados.length;
  const promGoles = golesAFavor / n;
  const promConcedidos = golesEnContra / n;
  const xg_estimado = promGoles * 0.85 + 0.2;

  return {
    xg_promedio: Math.round(xg_estimado * 100) / 100,
    forma: calcularForma(terminados, equipoId),
    puntos_ultimos7: Math.min(21, puntos),
    goles_promedio: Math.round(promGoles * 100) / 100,
    goles_concedidos_promedio: Math.round(promConcedidos * 100) / 100,
    corners_promedio: 4.5,
    h2h_victorias: victorias / n,
    lesiones_impacto: 0,
    partidos_analizados: n,
    fuente: 'football-data.org',
  };
}

function calcularForma(partidos, equipoId) {
  const ultimos5 = partidos.slice(-5);
  return ultimos5.map(p => {
    const esLocal = p.homeTeam?.id === equipoId;
    const gF = esLocal ? (p.score?.fullTime?.home || 0) : (p.score?.fullTime?.away || 0);
    const gC = esLocal ? (p.score?.fullTime?.away || 0) : (p.score?.fullTime?.home || 0);
    if (gF > gC) return 'W';
    if (gF === gC) return 'D';
    return 'L';
  }).join('');
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

export async function analizarPsicologiaClaude(equipoLocal, equipoVisitante, jornada, grupo, fecha) {
  const prompt = `Analiza el partido ${equipoLocal} vs ${equipoVisitante} del Mundial FIFA 2026.
Fecha: ${fecha}. Grupo: ${grupo}. Jornada: ${jornada}.

Busca noticias recientes sobre ambos equipos (lesiones, estado del grupo, narrativas, motivaciones).

Devuelve ÚNICAMENTE un objeto JSON válido con esta estructura exacta, sin texto adicional, sin markdown:
{
  "local": {
    "necesita_ganar": false,
    "venganza_narrativa": false,
    "rival_maldito": 0,
    "presion_mediatica": 3,
    "lider_disponible": true,
    "nombre_lider": "",
    "conflicto_interno": 0,
    "generacion_peak": false,
    "underdog": false,
    "clasifico_sufriendo": "comodo",
    "humillacion_previa": false
  },
  "visitante": {
    "necesita_ganar": false,
    "venganza_narrativa": false,
    "rival_maldito": 0,
    "presion_mediatica": 2,
    "lider_disponible": true,
    "nombre_lider": "",
    "conflicto_interno": 0,
    "generacion_peak": false,
    "underdog": false,
    "clasifico_sufriendo": "comodo",
    "humillacion_previa": false
  },
  "narrativa": "Una o dos oraciones sobre la narrativa principal del partido y qué lo hace especial.",
  "lesiones_destacadas": []
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API: ${response.status} — ${err}`);
    }

    const data = await response.json();
    const textoRespuesta = data.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    const jsonMatch = textoRespuesta.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No se encontró JSON en la respuesta de Claude');

    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.error('Error Claude API:', e);
    return getPsicoDefault();
  }
}

function getPsicoDefault() {
  return {
    local: {
      necesita_ganar: false, venganza_narrativa: false, rival_maldito: 0,
      presion_mediatica: 3, lider_disponible: true, nombre_lider: '',
      conflicto_interno: 0, generacion_peak: false, underdog: false,
      clasifico_sufriendo: 'comodo', humillacion_previa: false,
    },
    visitante: {
      necesita_ganar: false, venganza_narrativa: false, rival_maldito: 0,
      presion_mediatica: 2, lider_disponible: true, nombre_lider: '',
      conflicto_interno: 0, generacion_peak: false, underdog: false,
      clasifico_sufriendo: 'comodo', humillacion_previa: false,
    },
    narrativa: 'Análisis psicológico no disponible. Se usaron valores por defecto.',
    lesiones_destacadas: [],
  };
}

export function getFlag(nombreEquipo) {
  return EQUIPOS_FLAGS[nombreEquipo] || '🏳';
}

export function formatearFecha(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
