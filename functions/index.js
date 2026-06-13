const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const FOOTBALL_DATA_TOKEN = "39c4347bf04d4123809d0049efe4d3a5";
const VERSION_MODELO = "1.0";
const MODELO_CLAUDE = "claude-haiku-4-5";

exports.getMatches = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    try {
      const url =
        "https://api.football-data.org/v4/competitions/2000/matches?status=SCHEDULED,LIVE,FINISHED";

      const response = await fetch(url, {
        headers: {
          "X-Auth-Token": FOOTBALL_DATA_TOKEN,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error("football-data error", data);
        return res.status(response.status).json(data);
      }

      return res.status(200).json(data);
    } catch (error) {
      logger.error("Error en getMatches", error);
      return res.status(500).json({
        error: "Error consultando football-data.org",
      });
    }
  }
);

exports.getTeamStats = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    try {
      const equipoId = req.query.equipoId;
      const equipoNombre = req.query.equipoNombre || "Equipo";

      if (!equipoId) {
        return res.status(400).json({
          error: "Falta equipoId",
        });
      }

      const urls = [
        `https://api.football-data.org/v4/teams/${equipoId}/matches?limit=10&competitions=2000`,
        `https://api.football-data.org/v4/teams/${equipoId}/matches?limit=10`,
      ];

      const responses = await Promise.all(
        urls.map((url) =>
          fetch(url, {
            headers: {
              "X-Auth-Token": FOOTBALL_DATA_TOKEN,
            },
          })
        )
      );

      const data = await Promise.all(
        responses.map(async (r) => {
          if (!r.ok) return { matches: [] };
          return await r.json();
        })
      );

      const partidos = data.flatMap((d) => d.matches || []);

      const unicos = [
        ...new Map(partidos.map((p) => [p.id, p])).values(),
      ].slice(0, 10);

      const stats = procesarStatsPartidos(unicos, Number(equipoId), equipoNombre);

      return res.status(200).json(stats);
    } catch (error) {
      logger.error("Error en getTeamStats", error);
      return res.status(500).json(getStatsDefault(req.query.equipoNombre || "Equipo"));
    }
  }
);

function procesarStatsPartidos(partidos, equipoId, equipoNombre) {
  if (!partidos || partidos.length === 0) return getStatsDefault(equipoNombre);

  const terminados = partidos.filter((p) => p.status === "FINISHED");
  if (terminados.length === 0) return getStatsDefault(equipoNombre);

  let puntos = 0;
  let golesAFavor = 0;
  let golesEnContra = 0;
  let victorias = 0;

  terminados.forEach((p) => {
    const esLocal = p.homeTeam?.id === equipoId;

    const gF = esLocal
      ? p.score?.fullTime?.home || 0
      : p.score?.fullTime?.away || 0;

    const gC = esLocal
      ? p.score?.fullTime?.away || 0
      : p.score?.fullTime?.home || 0;

    golesAFavor += gF;
    golesEnContra += gC;

    if (gF > gC) {
      puntos += 3;
      victorias++;
    } else if (gF === gC) {
      puntos += 1;
    }
  });

  const n = terminados.length;
  const promGoles = golesAFavor / n;
  const promConcedidos = golesEnContra / n;
  const xgEstimado = promGoles * 0.85 + 0.2;

  return {
    xg_promedio: Math.round(xgEstimado * 100) / 100,
    forma: calcularForma(terminados, equipoId),
    puntos_ultimos7: Math.min(21, puntos),
    goles_promedio: Math.round(promGoles * 100) / 100,
    goles_concedidos_promedio: Math.round(promConcedidos * 100) / 100,
    corners_promedio: 4.5,
    h2h_victorias: Math.round((victorias / n) * 100) / 100,
    lesiones_impacto: 0,
    partidos_analizados: n,
    fuente: "football-data.org via Firebase Function",
  };
}

function calcularForma(partidos, equipoId) {
  const ultimos5 = partidos.slice(-5);

  return ultimos5
    .map((p) => {
      const esLocal = p.homeTeam?.id === equipoId;

      const gF = esLocal
        ? p.score?.fullTime?.home || 0
        : p.score?.fullTime?.away || 0;

      const gC = esLocal
        ? p.score?.fullTime?.away || 0
        : p.score?.fullTime?.home || 0;

      if (gF > gC) return "W";
      if (gF === gC) return "D";
      return "L";
    })
    .join("");
}

function getStatsDefault(equipoNombre) {
  return {
    xg_promedio: 1.2,
    forma: "WDWDW",
    puntos_ultimos7: 10,
    goles_promedio: 1.3,
    goles_concedidos_promedio: 1.0,
    corners_promedio: 4.5,
    h2h_victorias: 0.4,
    lesiones_impacto: 0,
    partidos_analizados: 0,
    fuente: "estimado",
  };
}

exports.analyzePsychology = onRequest(
  {
    cors: true,
    secrets: ["CLAUDE_API_KEY"],
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Método no permitido" });
      }

      const {
        partidoId,
        equipoLocal,
        equipoVisitante,
        jornada,
        grupo,
        fecha,
        fechaPartido,
        generar = false,
      } = req.body;

      if (!partidoId || !equipoLocal || !equipoVisitante) {
        return res.status(400).json({
          error: "Faltan datos obligatorios: partidoId, equipoLocal, equipoVisitante",
        });
      }

      const ref = db.collection("analisis_psicologico").doc(partidoId);
      const snap = await ref.get();

      if (!generar) {
        if (snap.exists) {
          return res.status(200).json({
            cache: true,
            ...snap.data(),
          });
        }

        return res.status(200).json({
          cache: false,
          estado: "pendiente",
          psicologico: getPsicoDefault(),
          mensaje: "No existe análisis IA generado para este partido.",
        });
      }

      if (!esDiaDelPartido(fechaPartido || fecha)) {
        return res.status(403).json({
          error: "El análisis IA solo puede generarse el día del partido.",
        });
      }

      const lockResult = await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);

        if (current.exists) {
          const data = current.data();

          if (data.estado === "completo" && data.version_modelo === VERSION_MODELO) {
            return { usarCache: true, data };
          }

          if (data.estado === "generando") {
            return {
              bloqueado: true,
              data,
            };
          }
        }

        tx.set(
          ref,
          {
            partidoId,
            equipoLocal,
            equipoVisitante,
            fechaPartido: fechaPartido || fecha || null,
            estado: "generando",
            generadoEn: admin.firestore.FieldValue.serverTimestamp(),
            modelo: MODELO_CLAUDE,
            webSearch: true,
            version_modelo: VERSION_MODELO,
          },
          { merge: true }
        );

        return { generar: true };
      });

      if (lockResult.usarCache) {
        return res.status(200).json({
          cache: true,
          ...lockResult.data,
        });
      }

      if (lockResult.bloqueado) {
        return res.status(200).json({
          cache: true,
          estado: "generando",
          mensaje: "El análisis IA ya está siendo generado por otro usuario.",
          ...lockResult.data,
        });
      }

      const prompt = `Analiza el partido ${equipoLocal} vs ${equipoVisitante} del Mundial FIFA 2026.
Fecha: ${fecha}. Grupo: ${grupo}. Jornada: ${jornada}.

Busca noticias recientes sobre ambos equipos: lesiones, estado del grupo, narrativas, motivaciones, presión mediática y conflictos internos.

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
  "lesiones_destacadas": [],
  "fuentes": []
}`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODELO_CLAUDE,
          max_tokens: 1024,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();

        await ref.set(
          {
            estado: "error",
            error: err,
            actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return res.status(response.status).json({
          error: "Claude API error",
          detail: err,
        });
      }

      const data = await response.json();

      const textoRespuesta = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      const jsonMatch = textoRespuesta.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        await ref.set(
          {
            estado: "error",
            error: "No se encontró JSON en la respuesta de Claude",
            raw: textoRespuesta,
            actualizadoEn: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        return res.status(500).json({
          error: "No se encontró JSON en la respuesta de Claude",
          raw: textoRespuesta,
        });
      }

      const psicologico = JSON.parse(jsonMatch[0]);

      const docFinal = {
        partidoId,
        equipoLocal,
        equipoVisitante,
        fechaPartido: fechaPartido || fecha || null,
        estado: "completo",
        generadoEn: admin.firestore.FieldValue.serverTimestamp(),
        modelo: MODELO_CLAUDE,
        webSearch: true,
        psicologico,
        fuentes: psicologico.fuentes || [],
        version_modelo: VERSION_MODELO,
      };

      await ref.set(docFinal, { merge: true });

      return res.status(200).json({
        cache: false,
        ...docFinal,
      });
    } catch (error) {
      logger.error("Error en analyzePsychology", error);
      return res.status(500).json({
        error: "Error analizando psicología con Claude",
      });
    }
  }
);

function esDiaDelPartido(fechaPartido) {
  if (!fechaPartido) return false;

  const hoyPE = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Lima",
  });

  const partidoPE = new Date(fechaPartido).toLocaleDateString("en-CA", {
    timeZone: "America/Lima",
  });

  return hoyPE === partidoPE;
}

function getPsicoDefault() {
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
exports.getFotmobDebug = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    try {
      const { date, matchId } = req.query;

      let url;

      if (matchId) {
        url = `https://www.fotmob.com/api/data/matchDetails?matchId=${matchId}`;
      } else {
        const fecha =
          date || new Date().toISOString().slice(0, 10).replaceAll("-", "");

        url = `https://www.fotmob.com/api/data/matches?date=${fecha}`;
      }

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Accept: "application/json,text/plain,*/*",
          Referer: "https://www.fotmob.com/",
        },
      });

      const text = await response.text();

      if (!response.ok) {
        return res.status(response.status).json({
          error: "FotMob error",
          status: response.status,
          url,
          raw: text.slice(0, 1000),
        });
      }

      let data;

      try {
        data = JSON.parse(text);
      } catch (e) {
        return res.status(500).json({
          error: "FotMob no devolvió JSON válido",
          url,
          raw: text.slice(0, 1000),
        });
      }

      return res.status(200).json({
        ok: true,
        source: "fotmob",
        mode: matchId ? "matchDetails" : "matchesByDate",
        url,
        data,
      });
    } catch (error) {
      logger.error("Error en getFotmobDebug", error);
      return res.status(500).json({
        error: "Error consultando FotMob",
        detail: error.message,
      });
    }
  }
);
exports.getAdvancedMatchStats = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    try {
      const { matchId } = req.query;

      if (!matchId) {
        return res.status(400).json({
          error: "Falta matchId de FotMob",
        });
      }

      const url = `https://www.fotmob.com/api/data/matchDetails?matchId=${matchId}`;

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Accept: "application/json,text/plain,*/*",
          Referer: "https://www.fotmob.com/",
        },
      });

      const text = await response.text();

      if (!response.ok) {
        return res.status(response.status).json({
          error: "FotMob error",
          status: response.status,
          raw: text.slice(0, 1000),
        });
      }

      const data = JSON.parse(text);

      const general = data.general || {};
      const headerTeams = data.header?.teams || [];
      const homeTeam = general.homeTeam || {};
      const awayTeam = general.awayTeam || {};

      const statsRaw = data.content?.stats?.Periods?.All?.stats || [];
      const statsPlanos = extraerStatsFotmob(statsRaw);

      const events = data.content?.matchFacts?.events?.events || [];
      const tarjetas = contarTarjetasFotmob(events);

      const shotmap = data.content?.shotmap?.shots || [];
      const momentum = data.content?.matchFacts?.momentum?.main?.data || [];

      const infoBox = data.content?.matchFacts?.infoBox || {};
      const playerOfTheMatch = data.content?.matchFacts?.playerOfTheMatch || null;

      const golesLocal = headerTeams[0]?.score ?? null;
      const golesVisitante = headerTeams[1]?.score ?? null;

      const resultado = {
        ok: true,
        fuente: "fotmob",
        matchIdFotmob: String(matchId),

        partido: {
          local: homeTeam.name || headerTeams[0]?.name || null,
          visitante: awayTeam.name || headerTeams[1]?.name || null,
          id_local_fotmob: homeTeam.id || headerTeams[0]?.id || null,
          id_visitante_fotmob: awayTeam.id || headerTeams[1]?.id || null,
          goles_local: golesLocal,
          goles_visitante: golesVisitante,
          ganador: calcularGanador(golesLocal, golesVisitante),
          terminado: general.finished ?? false,
          iniciado: general.started ?? false,
          cobertura: general.coverageLevel || null,
          fecha_utc: general.matchTimeUTCDate || null,
          liga: general.leagueName || null,
          ronda: general.leagueRoundName || null,
        },

        resultado_real: {
          goles_local: golesLocal,
          goles_visitante: golesVisitante,
          ganador: calcularGanador(golesLocal, golesVisitante),
          terminado: general.finished ?? false,
          fuente_resultado: "fotmob",
        },

        stats_avanzadas: {
          xg_local: getStat(statsPlanos, "expected_goals", "home"),
          xg_visitante: getStat(statsPlanos, "expected_goals", "away"),

          posesion_local: getStat(statsPlanos, "BallPossesion", "home"),
          posesion_visitante: getStat(statsPlanos, "BallPossesion", "away"),

          tiros_local: getStat(statsPlanos, "total_shots", "home"),
          tiros_visitante: getStat(statsPlanos, "total_shots", "away"),

          tiros_puerta_local: getStat(statsPlanos, "ShotsOnTarget", "home"),
          tiros_puerta_visitante: getStat(statsPlanos, "ShotsOnTarget", "away"),

          tiros_fuera_local: getStat(statsPlanos, "ShotsOffTarget", "home"),
          tiros_fuera_visitante: getStat(statsPlanos, "ShotsOffTarget", "away"),

          tiros_bloqueados_local: getStat(statsPlanos, "blocked_shots", "home"),
          tiros_bloqueados_visitante: getStat(statsPlanos, "blocked_shots", "away"),

          grandes_ocaciones_local: getStat(statsPlanos, "big_chance", "home"),
          grandes_ocaciones_visitante: getStat(statsPlanos, "big_chance", "away"),

          grandes_ocaciones_falladas_local:
            getStat(statsPlanos, "big_chance_missed_title", "home"),
          grandes_ocaciones_falladas_visitante:
            getStat(statsPlanos, "big_chance_missed_title", "away"),

          toques_area_local: getStat(statsPlanos, "touches_opp_box", "home"),
          toques_area_visitante: getStat(statsPlanos, "touches_opp_box", "away"),

          corners_local: getStat(statsPlanos, "corners", "home"),
          corners_visitante: getStat(statsPlanos, "corners", "away"),

          offsides_local: getStat(statsPlanos, "Offsides", "home"),
          offsides_visitante: getStat(statsPlanos, "Offsides", "away"),

          faltas_local: getStat(statsPlanos, "fouls", "home"),
          faltas_visitante: getStat(statsPlanos, "fouls", "away"),

          pases_precisos_local: getStat(statsPlanos, "accurate_passes", "home"),
          pases_precisos_visitante: getStat(statsPlanos, "accurate_passes", "away"),

          amarillas_local:
            getStat(statsPlanos, "yellow_cards", "home") ?? tarjetas.amarillas_local,
          amarillas_visitante:
            getStat(statsPlanos, "yellow_cards", "away") ?? tarjetas.amarillas_visitante,

          rojas_local: tarjetas.rojas_local,
          rojas_visitante: tarjetas.rojas_visitante,
        },

        contexto_partido: {
          estadio: infoBox?.Stadium?.name || null,
          ciudad: infoBox?.Stadium?.city || null,
          pais: infoBox?.Stadium?.country || null,
          capacidad: infoBox?.Stadium?.capacity || null,
          superficie: infoBox?.Stadium?.surface || null,
          arbitro: infoBox?.Referee?.text || null,
          arbitro_pais: infoBox?.Referee?.country || null,
          asistencia: infoBox?.Attendance || null,
          player_of_the_match: playerOfTheMatch
            ? {
                id: playerOfTheMatch.id || null,
                nombre:
                  playerOfTheMatch.name?.fullName ||
                  `${playerOfTheMatch.name?.firstName || ""} ${playerOfTheMatch.name?.lastName || ""}`.trim(),
                equipo: playerOfTheMatch.teamName || null,
                rating: playerOfTheMatch.rating?.num || null,
              }
            : null,
        },

        shotmap_resumen: resumirShotmap(shotmap, homeTeam.id, awayTeam.id),

        momentum_resumen: resumirMomentum(momentum),

        eventos_clave: resumirEventos(events),

        metadata: {
          generado_en: new Date().toISOString(),
          endpoint: "getAdvancedMatchStats",
          version: "1.1-fotmob",
        },
      };

      completarTotales(resultado.stats_avanzadas);

      return res.status(200).json(resultado);
    } catch (error) {
      logger.error("Error en getAdvancedMatchStats", error);

      return res.status(500).json({
        error: "Error obteniendo estadísticas avanzadas",
        detail: error.message,
      });
    }
  }
);

function extraerStatsFotmob(statsRaw) {
  const salida = {};

  for (const bloque of statsRaw) {
    const stats = bloque.stats || [];

    for (const item of stats) {
      if (!item.key || !Array.isArray(item.stats)) continue;

      salida[item.key] = {
        title: item.title,
        home: limpiarValorFotmob(item.stats[0]),
        away: limpiarValorFotmob(item.stats[1]),
      };
    }
  }

  return salida;
}

function limpiarValorFotmob(valor) {
  if (valor === null || valor === undefined) return null;

  if (typeof valor === "number") return valor;

  if (typeof valor === "string") {
    const limpio = valor.replace("%", "").trim();

    const numero = Number(limpio);

    if (!Number.isNaN(numero)) return numero;

    return valor;
  }

  return valor;
}

function getStat(statsPlanos, key, side) {
  return statsPlanos?.[key]?.[side] ?? null;
}

function contarTarjetasFotmob(events) {
  const out = {
    amarillas_local: 0,
    amarillas_visitante: 0,
    rojas_local: 0,
    rojas_visitante: 0,
  };

  for (const ev of events) {
    if (ev.type !== "Card") continue;

    const esLocal = ev.isHome === true;
    const card = (ev.card || "").toLowerCase();

    if (card.includes("yellow")) {
      if (esLocal) out.amarillas_local++;
      else out.amarillas_visitante++;
    }

    if (card.includes("red")) {
      if (esLocal) out.rojas_local++;
      else out.rojas_visitante++;
    }
  }

  return out;
}

function calcularGanador(golesLocal, golesVisitante) {
  if (golesLocal === null || golesVisitante === null) return null;

  if (golesLocal > golesVisitante) return "local";
  if (golesVisitante > golesLocal) return "visitante";
  return "empate";
}

function completarTotales(stats) {
  stats.corners_totales = sumar(stats.corners_local, stats.corners_visitante);
  stats.amarillas_totales = sumar(stats.amarillas_local, stats.amarillas_visitante);
  stats.rojas_totales = sumar(stats.rojas_local, stats.rojas_visitante);
  stats.offsides_totales = sumar(stats.offsides_local, stats.offsides_visitante);
  stats.faltas_totales = sumar(stats.faltas_local, stats.faltas_visitante);
  stats.tiros_totales = sumar(stats.tiros_local, stats.tiros_visitante);
  stats.tiros_puerta_totales = sumar(stats.tiros_puerta_local, stats.tiros_puerta_visitante);
}

function sumar(a, b) {
  if (a === null || a === undefined) return null;
  if (b === null || b === undefined) return null;
  return Number(a) + Number(b);
}

function resumirShotmap(shotmap, homeTeamId, awayTeamId) {
  const resumen = {
    total_tiros: shotmap.length,
    tiros_local: 0,
    tiros_visitante: 0,
    xg_local_shotmap: 0,
    xg_visitante_shotmap: 0,
    tiros_puerta_local_shotmap: 0,
    tiros_puerta_visitante_shotmap: 0,
    goles_local_shotmap: 0,
    goles_visitante_shotmap: 0,
    tiros: [],
  };

  for (const tiro of shotmap) {
    const esLocal = Number(tiro.teamId) === Number(homeTeamId);
    const esVisitante = Number(tiro.teamId) === Number(awayTeamId);
    const xg = Number(tiro.expectedGoals || 0);

    if (esLocal) {
      resumen.tiros_local++;
      resumen.xg_local_shotmap += xg;
      if (tiro.isOnTarget) resumen.tiros_puerta_local_shotmap++;
      if (tiro.eventType === "Goal") resumen.goles_local_shotmap++;
    }

    if (esVisitante) {
      resumen.tiros_visitante++;
      resumen.xg_visitante_shotmap += xg;
      if (tiro.isOnTarget) resumen.tiros_puerta_visitante_shotmap++;
      if (tiro.eventType === "Goal") resumen.goles_visitante_shotmap++;
    }

    resumen.tiros.push({
      minuto: tiro.min ?? null,
      equipo_id: tiro.teamId ?? null,
      jugador: tiro.playerName ?? null,
      evento: tiro.eventType ?? null,
      xg: tiro.expectedGoals ?? null,
      xgot: tiro.expectedGoalsOnTarget ?? null,
      tipo_tiro: tiro.shotType ?? null,
      situacion: tiro.situation ?? null,
      al_arco: tiro.isOnTarget ?? null,
      dentro_area: tiro.isFromInsideBox ?? null,
    });
  }

  resumen.xg_local_shotmap = redondear(resumen.xg_local_shotmap, 2);
  resumen.xg_visitante_shotmap = redondear(resumen.xg_visitante_shotmap, 2);

  return resumen;
}

function resumirMomentum(momentum) {
  if (!Array.isArray(momentum) || momentum.length === 0) {
    return {
      disponible: false,
      promedio_local: null,
      promedio_visitante: null,
      dominio_local_pct: null,
      dominio_visitante_pct: null,
      pico_local: null,
      pico_visitante: null,
      serie: [],
    };
  }

  let sumaLocal = 0;
  let sumaVisitante = 0;
  let minsLocal = 0;
  let minsVisitante = 0;
  let picoLocal = 0;
  let picoVisitante = 0;

  for (const m of momentum) {
    const value = Number(m.value || 0);

    if (value > 0) {
      sumaLocal += value;
      minsLocal++;
      if (value > picoLocal) picoLocal = value;
    }

    if (value < 0) {
      sumaVisitante += Math.abs(value);
      minsVisitante++;
      if (Math.abs(value) > picoVisitante) picoVisitante = Math.abs(value);
    }
  }

  const total = minsLocal + minsVisitante;

  return {
    disponible: true,
    promedio_local: minsLocal ? redondear(sumaLocal / minsLocal, 2) : 0,
    promedio_visitante: minsVisitante ? redondear(sumaVisitante / minsVisitante, 2) : 0,
    dominio_local_pct: total ? redondear((minsLocal / total) * 100, 1) : null,
    dominio_visitante_pct: total ? redondear((minsVisitante / total) * 100, 1) : null,
    pico_local: picoLocal,
    pico_visitante: picoVisitante,
    serie: momentum.map((m) => ({
      minuto: m.minute,
      valor: m.value,
    })),
  };
}

function resumirEventos(events) {
  return events
    .filter((ev) =>
      ["Goal", "Card", "Substitution"].includes(ev.type)
    )
    .map((ev) => ({
      minuto: ev.timeStr ?? ev.time ?? null,
      tipo: ev.type,
      local: ev.isHome ?? null,
      jugador: ev.player?.name || ev.nameStr || null,
      tarjeta: ev.card || null,
      marcador: ev.newScore || null,
    }));
}

function redondear(valor, decimales = 2) {
  const factor = Math.pow(10, decimales);
  return Math.round(Number(valor) * factor) / factor;
}
exports.syncAdvancedStats = onRequest(
  {
    cors: true,
  },
  async (req, res) => {
    try {
      const dateInput = req.query.date;

      if (!dateInput) {
        return res.status(400).json({
          error: "Falta date. Usa formato YYYY-MM-DD o YYYYMMDD",
          ejemplo: "?date=2026-06-12",
        });
      }

      const fechaISO = normalizarFechaISO(dateInput);
      const fechaFotmob = fechaISO.replaceAll("-", "");

      // 1. Partidos desde football-data.org
      const footballUrl =
        `https://api.football-data.org/v4/competitions/2000/matches?dateFrom=${fechaISO}&dateTo=${fechaISO}`;

      const footballRes = await fetch(footballUrl, {
        headers: {
          "X-Auth-Token": FOOTBALL_DATA_TOKEN,
        },
      });

      if (!footballRes.ok) {
        const errorText = await footballRes.text();

        return res.status(footballRes.status).json({
          error: "Error consultando football-data.org",
          status: footballRes.status,
          detail: errorText.slice(0, 1000),
        });
      }

      const footballData = await footballRes.json();
      const partidosFootball = footballData.matches || [];

      // 2. Partidos desde FotMob
      const fotmobUrl =
        `https://www.fotmob.com/api/data/matches?date=${fechaFotmob}`;

      const fotmobRes = await fetch(fotmobUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          Accept: "application/json,text/plain,*/*",
          Referer: "https://www.fotmob.com/",
        },
      });

      if (!fotmobRes.ok) {
        const errorText = await fotmobRes.text();

        return res.status(fotmobRes.status).json({
          error: "Error consultando FotMob",
          status: fotmobRes.status,
          detail: errorText.slice(0, 1000),
        });
      }

      const fotmobData = await fotmobRes.json();

      const partidosFotmob = extraerPartidosWorldCupFotmob(fotmobData);

      const resultados = [];

      for (const partido of partidosFootball) {
        const partidoId = String(partido.id);

        const localFD = partido.homeTeam?.name || "";
        const visitanteFD = partido.awayTeam?.name || "";

        const candidato = encontrarPartidoFotmob(
          localFD,
          visitanteFD,
          partidosFotmob
        );

        if (!candidato) {
          resultados.push({
            partidoId,
            local: localFD,
            visitante: visitanteFD,
            estado: "sin_match_fotmob",
          });

          continue;
        }

        // Solo traemos detalle si el partido ya terminó o si FotMob lo marca terminado
        const terminadoFD = partido.status === "FINISHED";
        const terminadoFotmob = candidato.status?.finished === true;

        if (!terminadoFD && !terminadoFotmob) {
          resultados.push({
            partidoId,
            matchIdFotmob: String(candidato.id),
            local: localFD,
            visitante: visitanteFD,
            estado: "no_terminado",
          });

          continue;
        }

        const detalle = await obtenerDetalleFotmob(candidato.id);
        const statsLimpias = construirAdvancedStatsFotmob(detalle, candidato.id);

        await db.collection("stats_avanzadas").doc(partidoId).set(
          {
            partidoId,
            matchIdFotmob: String(candidato.id),

            football_data: {
              partidoId,
              local: localFD,
              visitante: visitanteFD,
              fecha_utc: partido.utcDate || null,
              status: partido.status || null,
            },

            ...statsLimpias,

            actualizado_en: admin.firestore.FieldValue.serverTimestamp(),
            version: "1.1-fotmob-auto",
          },
          { merge: true }
        );

        await db.collection("mapeo_partidos_fotmob").doc(partidoId).set(
          {
            partidoId,
            matchIdFotmob: String(candidato.id),
            local_football_data: localFD,
            visitante_football_data: visitanteFD,
            local_fotmob: candidato.home?.name || null,
            visitante_fotmob: candidato.away?.name || null,
            fecha: fechaISO,
            actualizado_en: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

        resultados.push({
          partidoId,
          matchIdFotmob: String(candidato.id),
          local: localFD,
          visitante: visitanteFD,
          localFotmob: candidato.home?.name || null,
          visitanteFotmob: candidato.away?.name || null,
          estado: "guardado",
        });
      }

      return res.status(200).json({
        ok: true,
        fecha: fechaISO,
        footballDataPartidos: partidosFootball.length,
        fotmobPartidosWorldCup: partidosFotmob.length,
        resultados,
      });
    } catch (error) {
      logger.error("Error en syncAdvancedStats", error);

      return res.status(500).json({
        error: "Error sincronizando estadísticas avanzadas",
        detail: error.message,
      });
    }
  }
);
function normalizarFechaISO(dateInput) {
  const txt = String(dateInput).trim();

  if (/^\d{8}$/.test(txt)) {
    return `${txt.slice(0, 4)}-${txt.slice(4, 6)}-${txt.slice(6, 8)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) {
    return txt;
  }

  throw new Error("Fecha inválida. Usa YYYY-MM-DD o YYYYMMDD");
}

function extraerPartidosWorldCupFotmob(fotmobData) {
  const leagues = fotmobData.leagues || [];
  const partidos = [];

  for (const league of leagues) {
    const esWorldCup =
      league.parentLeagueId === 77 ||
      league.primaryId === 77 ||
      String(league.parentLeagueName || "").toLowerCase().includes("world cup") ||
      String(league.name || "").toLowerCase().includes("world cup");

    if (!esWorldCup) continue;

    for (const match of league.matches || []) {
      partidos.push({
        ...match,
        leagueName: league.name,
        parentLeagueName: league.parentLeagueName,
      });
    }
  }

  return partidos;
}

function encontrarPartidoFotmob(localFD, visitanteFD, partidosFotmob) {
  const localNorm = normalizarNombreEquipo(localFD);
  const visitanteNorm = normalizarNombreEquipo(visitanteFD);

  let mejor = null;
  let mejorScore = 0;

  for (const p of partidosFotmob) {
    const localFM = normalizarNombreEquipo(p.home?.name || p.home?.longName || "");
    const visitanteFM = normalizarNombreEquipo(p.away?.name || p.away?.longName || "");

    const scoreDirecto =
      similitudEquipo(localNorm, localFM) +
      similitudEquipo(visitanteNorm, visitanteFM);

    const scoreInvertido =
      similitudEquipo(localNorm, visitanteFM) +
      similitudEquipo(visitanteNorm, localFM);

    const score = Math.max(scoreDirecto, scoreInvertido);

    if (score > mejorScore) {
      mejorScore = score;
      mejor = p;
    }
  }

  // Exigimos match fuerte: 0.80 + 0.80 aprox.
  if (mejorScore >= 1.6) return mejor;

  return null;
}

function normalizarNombreEquipo(nombre) {
  let x = String(nombre || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const alias = {
    "usa": "united states",
    "united states of america": "united states",
    "czech republic": "czechia",
    "korea republic": "south korea",
    "republic of korea": "south korea",
    "bosnia herzegovina": "bosnia and herzegovina",
    "bosnia": "bosnia and herzegovina",
    "ivory coast": "cote d ivoire",
    "cote divoire": "cote d ivoire",
    "dr congo": "congo dr",
    "congo dr": "congo dr",
    "curacao": "curacao",
  };

  return alias[x] || x;
}

function similitudEquipo(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;

  if (a.includes(b) || b.includes(a)) return 0.9;

  const palabrasA = new Set(a.split(" "));
  const palabrasB = new Set(b.split(" "));

  let comunes = 0;

  for (const palabra of palabrasA) {
    if (palabrasB.has(palabra)) comunes++;
  }

  const total = Math.max(palabrasA.size, palabrasB.size);

  return total ? comunes / total : 0;
}

async function obtenerDetalleFotmob(matchId) {
  const url = `https://www.fotmob.com/api/data/matchDetails?matchId=${matchId}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      Referer: "https://www.fotmob.com/",
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`FotMob matchDetails ${response.status}: ${text.slice(0, 500)}`);
  }

  return JSON.parse(text);
}
function construirAdvancedStatsFotmob(data, matchId) {
  const general = data.general || {};
  const headerTeams = data.header?.teams || [];
  const homeTeam = general.homeTeam || {};
  const awayTeam = general.awayTeam || {};

  const statsRaw = data.content?.stats?.Periods?.All?.stats || [];
  const statsPlanos = extraerStatsFotmob(statsRaw);

  const events = data.content?.matchFacts?.events?.events || [];
  const tarjetas = contarTarjetasFotmob(events);

  const shotmap = data.content?.shotmap?.shots || [];
  const momentum = data.content?.matchFacts?.momentum?.main?.data || [];

  const infoBox = data.content?.matchFacts?.infoBox || {};
  const playerOfTheMatch = data.content?.matchFacts?.playerOfTheMatch || null;

  const golesLocal = headerTeams[0]?.score ?? null;
  const golesVisitante = headerTeams[1]?.score ?? null;

  const resultado = {
    fuente: "fotmob",
    matchIdFotmob: String(matchId),

    partido: {
      local: homeTeam.name || headerTeams[0]?.name || null,
      visitante: awayTeam.name || headerTeams[1]?.name || null,
      id_local_fotmob: homeTeam.id || headerTeams[0]?.id || null,
      id_visitante_fotmob: awayTeam.id || headerTeams[1]?.id || null,
      goles_local: golesLocal,
      goles_visitante: golesVisitante,
      ganador: calcularGanador(golesLocal, golesVisitante),
      terminado: general.finished ?? false,
      iniciado: general.started ?? false,
      cobertura: general.coverageLevel || null,
      fecha_utc: general.matchTimeUTCDate || null,
      liga: general.leagueName || null,
      ronda: general.leagueRoundName || null,
    },

    resultado_real: {
      goles_local: golesLocal,
      goles_visitante: golesVisitante,
      ganador: calcularGanador(golesLocal, golesVisitante),
      terminado: general.finished ?? false,
      fuente_resultado: "fotmob",
    },

    stats_avanzadas: {
      xg_local: getStat(statsPlanos, "expected_goals", "home"),
      xg_visitante: getStat(statsPlanos, "expected_goals", "away"),

      posesion_local: getStat(statsPlanos, "BallPossesion", "home"),
      posesion_visitante: getStat(statsPlanos, "BallPossesion", "away"),

      tiros_local: getStat(statsPlanos, "total_shots", "home"),
      tiros_visitante: getStat(statsPlanos, "total_shots", "away"),

      tiros_puerta_local: getStat(statsPlanos, "ShotsOnTarget", "home"),
      tiros_puerta_visitante: getStat(statsPlanos, "ShotsOnTarget", "away"),

      tiros_fuera_local: getStat(statsPlanos, "ShotsOffTarget", "home"),
      tiros_fuera_visitante: getStat(statsPlanos, "ShotsOffTarget", "away"),

      tiros_bloqueados_local: getStat(statsPlanos, "blocked_shots", "home"),
      tiros_bloqueados_visitante: getStat(statsPlanos, "blocked_shots", "away"),

      grandes_ocaciones_local: getStat(statsPlanos, "big_chance", "home"),
      grandes_ocaciones_visitante: getStat(statsPlanos, "big_chance", "away"),

      grandes_ocaciones_falladas_local:
        getStat(statsPlanos, "big_chance_missed_title", "home"),
      grandes_ocaciones_falladas_visitante:
        getStat(statsPlanos, "big_chance_missed_title", "away"),

      toques_area_local: getStat(statsPlanos, "touches_opp_box", "home"),
      toques_area_visitante: getStat(statsPlanos, "touches_opp_box", "away"),

      corners_local: getStat(statsPlanos, "corners", "home"),
      corners_visitante: getStat(statsPlanos, "corners", "away"),

      offsides_local: getStat(statsPlanos, "Offsides", "home"),
      offsides_visitante: getStat(statsPlanos, "Offsides", "away"),

      faltas_local: getStat(statsPlanos, "fouls", "home"),
      faltas_visitante: getStat(statsPlanos, "fouls", "away"),

      pases_precisos_local: getStat(statsPlanos, "accurate_passes", "home"),
      pases_precisos_visitante: getStat(statsPlanos, "accurate_passes", "away"),

      amarillas_local:
        getStat(statsPlanos, "yellow_cards", "home") ?? tarjetas.amarillas_local,
      amarillas_visitante:
        getStat(statsPlanos, "yellow_cards", "away") ?? tarjetas.amarillas_visitante,

      rojas_local: tarjetas.rojas_local,
      rojas_visitante: tarjetas.rojas_visitante,
    },

    contexto_partido: {
      estadio: infoBox?.Stadium?.name || null,
      ciudad: infoBox?.Stadium?.city || null,
      pais: infoBox?.Stadium?.country || null,
      capacidad: infoBox?.Stadium?.capacity || null,
      superficie: infoBox?.Stadium?.surface || null,
      arbitro: infoBox?.Referee?.text || null,
      arbitro_pais: infoBox?.Referee?.country || null,
      asistencia: infoBox?.Attendance || null,
      player_of_the_match: playerOfTheMatch
        ? {
            id: playerOfTheMatch.id || null,
            nombre:
              playerOfTheMatch.name?.fullName ||
              `${playerOfTheMatch.name?.firstName || ""} ${playerOfTheMatch.name?.lastName || ""}`.trim(),
            equipo: playerOfTheMatch.teamName || null,
            rating: playerOfTheMatch.rating?.num || null,
          }
        : null,
    },

    shotmap_resumen: resumirShotmap(shotmap, homeTeam.id, awayTeam.id),

    momentum_resumen: resumirMomentum(momentum),

    eventos_clave: resumirEventos(events),

    metadata: {
      generado_en: new Date().toISOString(),
      endpoint: "syncAdvancedStats",
      version: "1.1-fotmob-auto",
    },
  };

  completarTotales(resultado.stats_avanzadas);

  return resultado;
}