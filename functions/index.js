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

  const hoy = new Date();
  const partido = new Date(fechaPartido);

  return (
    hoy.getFullYear() === partido.getFullYear() &&
    hoy.getMonth() === partido.getMonth() &&
    hoy.getDate() === partido.getDate()
  );
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