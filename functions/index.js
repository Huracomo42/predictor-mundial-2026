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