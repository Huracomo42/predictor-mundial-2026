const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const FOOTBALL_DATA_TOKEN = "39c4347bf04d4123809d0049efe4d3a5";

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

      const { equipoLocal, equipoVisitante, jornada, grupo, fecha } = req.body;

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
  "lesiones_destacadas": []
}`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
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
        return res.status(500).json({
          error: "No se encontró JSON en la respuesta de Claude",
          raw: textoRespuesta,
        });
      }

      return res.status(200).json(JSON.parse(jsonMatch[0]));
    } catch (error) {
      logger.error("Error en analyzePsychology", error);
      return res.status(500).json({
        error: "Error analizando psicología con Claude",
      });
    }
  }
);