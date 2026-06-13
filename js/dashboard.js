import { getPartidosMundial, getFlag, formatearFecha } from './api.js';
import { getTodasPredicciones, getBoostMundialista, calcularMetricas } from './firebase-db.js';

async function init() {
  const hoy = new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('fecha-hoy').textContent = hoy;

  cargarMetricas();
  cargarPartidos();
  cargarBoostMundialista();
}

async function cargarMetricas() {
  try {
    const m = await calcularMetricas();

    const pctSeguras = m.seguras.total > 0
      ? Math.round((m.seguras.acertadas / m.seguras.total) * 100) + '%'
      : '—';
    const pctMedias = m.medias.total > 0
      ? Math.round((m.medias.acertadas / m.medias.total) * 100) + '%'
      : '—';
    const pctMalcriadas = m.malcriadas.total > 0
      ? Math.round((m.malcriadas.acertadas / m.malcriadas.total) * 100) + '%'
      : '—';

    const evProm = m.ev_count > 0
      ? (m.ev_total / m.ev_count).toFixed(2)
      : '—';

    document.getElementById('stat-seguras').textContent =
      m.seguras.total > 0 ? `${m.seguras.acertadas}/${m.seguras.total}` : '—';
    document.getElementById('stat-medias').textContent =
      m.medias.total > 0 ? `${m.medias.acertadas}/${m.medias.total}` : '—';
    document.getElementById('stat-malcriadas').textContent =
      m.malcriadas.total > 0 ? `${m.malcriadas.acertadas}/${m.malcriadas.total}` : '—';
    document.getElementById('stat-ev').textContent = evProm !== '—' ? `+${evProm}` : '—';

    const totalAciertos = m.seguras.acertadas + m.medias.acertadas + m.malcriadas.acertadas;
    const totalApuestas = m.seguras.total + m.medias.total + m.malcriadas.total;
    if (totalApuestas > 0) {
      document.getElementById('precision-global').textContent =
        Math.round((totalAciertos / totalApuestas) * 100) + '%';
    }
  } catch (e) {
    console.error('Error cargando métricas:', e);
  }
}

async function cargarPartidos() {
  const container = document.getElementById('matches-container');

  try {
    const [partidos, predicciones] = await Promise.all([
      getPartidosMundial(),
      getTodasPredicciones(),
    ]);

    const prediccionesMap = {};
    predicciones.forEach(p => { prediccionesMap[p.id] = p; });

    if (partidos.length === 0) {
      container.innerHTML = `<div class="empty-state">No se encontraron partidos. Verificá la conexión con football-data.org.</div>`;
      return;
    }

    const hoy = new Date();
    const proximosYHoy = partidos
      .filter(p => {
        const fecha = new Date(p.utcDate);
        const diff = (fecha - hoy) / (1000 * 60 * 60 * 24);
        return diff > -2 && diff < 7;
      })
      .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
      const idsApi = new Set(partidos.map(p => p.id?.toString()));

      const prediccionesHuerfanas = predicciones
        .filter(p => !idsApi.has(p.id?.toString()))
        .map(p => convertirPrediccionAPartido(p));

      const listaFinal = [
        ...proximosYHoy,
        ...prediccionesHuerfanas
      ].sort((a, b) => new Date(a.utcDate || 0) - new Date(b.utcDate || 0));

    if (listaFinal.length === 0) {
      container.innerHTML = `<div class="empty-state">Sin partidos en los próximos 7 días.</div>`;
      return;
    }

    container.innerHTML = listaFinal.map(p => renderMatchCard(p, prediccionesMap)).join('');

  } catch (e) {
    console.error('Error cargando partidos:', e);
    container.innerHTML = `<div class="empty-state">Error cargando partidos. Verificá tu conexión.</div>`;
  }
}

function renderMatchCard(partido, prediccionesMap) {
  const pred = prediccionesMap[partido.id.toString()];
  const flagLocal = getFlag(partido.homeTeam?.name || '');
  const flagVisitante = getFlag(partido.awayTeam?.name || '');
  const fecha = formatearFecha(partido.utcDate);
  const esLive = partido.status === 'LIVE' || partido.status === 'IN_PLAY';
  const terminado = partido.status === 'FINISHED';

  let statusClass = 'pending';
  let statusText = 'Pendiente';
  let scoreHTML = `<div class="match-vs">VS</div>`;

  if (esLive) {
    statusClass = 'live';
    statusText = 'EN VIVO';
    const gL = partido.score?.fullTime?.home ?? partido.score?.halfTime?.home ?? '?';
    const gV = partido.score?.fullTime?.away ?? partido.score?.halfTime?.away ?? '?';
    scoreHTML = `<div class="match-score">${gL} — ${gV}</div>`;
  } else if (terminado) {
    statusClass = pred ? 'predicted' : 'finished';
    statusText = pred ? '✓ Predicho' : 'Finalizado';
    const gL = partido.score?.fullTime?.home ?? 0;
    const gV = partido.score?.fullTime?.away ?? 0;
    scoreHTML = `<div class="match-score">${gL} — ${gV}</div>`;
  } else if (pred) {
    statusClass = 'predicted';
    statusText = '✓ Predicho';
  }

  const botonAction = terminado && !pred?.resultado_real
    ? `<button class="btn-secondary" onclick="window.location.href='historial.html'">Ingresar resultado</button>`
    : `<button class="btn-secondary" onclick="window.location.href='analisis.html?id=${partido.id}'">
        ${pred ? 'Ver análisis' : 'Analizar →'}
      </button>`;

  const confText = pred
    ? `<span class="match-confidence">${pred.apuestas?.[0]?.mercado?.substring(0, 25) || ''}...</span>`
    : '';

  return `
    <div class="match-card ${statusClass}">
      <div class="team-info">
        <span class="team-flag">${flagLocal}</span>
        <div>
          <div class="team-name">${partido.homeTeam?.name || 'TBD'}</div>
          <div class="team-xg">${pred ? `xG: ${pred.scores?.local?.scoreStat || '—'}` : grupo(partido)}</div>
        </div>
      </div>
      <div class="match-mid">
        <div class="match-time">${fecha}</div>
        ${scoreHTML}
        <span class="match-status status-${statusClass}">${statusText}</span>
      </div>
      <div class="team-info right">
        <span class="team-flag">${flagVisitante}</span>
        <div>
          <div class="team-name">${partido.awayTeam?.name || 'TBD'}</div>
          <div class="team-xg">${pred ? `xG: ${pred.scores?.visitante?.scoreStat || '—'}` : ''}</div>
        </div>
      </div>
      <div class="match-actions">
        ${botonAction}
        ${confText}
      </div>
    </div>
  `;
}

function grupo(partido) {
  return partido.group ? `Grupo ${partido.group}` : 'Mundial 2026';
}

async function cargarBoostMundialista() {
  try {
    const boosts = await getBoostMundialista();
    if (boosts.length === 0) return;

    document.getElementById('boost-section').style.display = 'block';
    const lista = document.getElementById('boost-list');

    lista.innerHTML = boosts
      .filter(b => b.partidos?.length > 0)
      .sort((a, b) => (b.boost_calculado || 1) - (a.boost_calculado || 1))
      .map(b => {
        const diff = ((b.boost_calculado || 1) - 1) * 100;
        const clase = diff > 5 ? 'pos' : diff < -5 ? 'neg' : 'neu';
        const symbol = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
        const pct = Math.min(100, Math.max(10, (b.xg_promedio_torneo || 1) / 2.5 * 100));
        return `
          <div class="boost-row">
            <span class="boost-team">${b.equipo}</span>
            <div class="boost-bar-bg"><div class="boost-bar-fill" style="width:${pct}%"></div></div>
            <span class="boost-pre">${(b.xg_pre_torneo || 0).toFixed(2)}</span>
            <span class="boost-wc ${clase}">${(b.xg_promedio_torneo || 0).toFixed(2)} ${symbol}</span>
          </div>
        `;
      }).join('');
  } catch (e) {
    console.error('Error boost:', e);
  }
}

function convertirPrediccionAPartido(pred) {
  const partido = pred.partido || {};

  const nombreLocal =
    partido.nombreLocal ||
    partido.equipoLocal ||
    partido.local ||
    'Local';

  const nombreVisitante =
    partido.nombreVisitante ||
    partido.equipoVisitante ||
    partido.visitante ||
    'Visitante';

  return {
    id: pred.id,
    utcDate:
      partido.fecha ||
      pred.fecha ||
      pred.guardado_en?.toDate?.()?.toISOString?.() ||
      new Date().toISOString(),
    status: pred.resultado_real ? 'FINISHED' : 'PREDICTED_SAVED',
    group: partido.grupo || partido.group || '',
    venue: partido.estadio || '',
    homeTeam: {
      name: nombreLocal,
    },
    awayTeam: {
      name: nombreVisitante,
    },
    score: pred.resultado_real
      ? {
          fullTime: {
            home: Number(pred.resultado_real.goles_local ?? 0),
            away: Number(pred.resultado_real.goles_visitante ?? 0),
          },
        }
      : null,
  };
}

init();
