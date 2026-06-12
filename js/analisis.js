import { getPartidosMundial, getStatsEquipo, analizarPsicologiaClaude, getFlag, formatearFecha } from './api.js';
import { calcularPrediccion } from './modelo.js';
import { guardarPrediccion, getPrediccion, calcularMetricas } from './firebase-db.js';
import { ESTADIOS_ALTITUD } from './config.js';

let partidoActual = null;
let resultadoAnalisis = null;

async function init() {
  cargarMetricasNav();

  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');

  const partidos = await getPartidosMundial();

  const disponibles = document.getElementById('partidos-disponibles');
  if (partidos.length === 0) {
    disponibles.innerHTML = `<div class="empty-state">No se pudieron cargar los partidos.</div>`;
    return;
  }

  const futuros = partidos
    .filter(p => {
      const f = new Date(p.utcDate);
      return (f - new Date()) > -1000 * 60 * 60 * 4;
    })
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .slice(0, 16);

  const predsMap = {};
  for (const p of futuros) {
    const pred = await getPrediccion(p.id.toString());
    if (pred) predsMap[p.id] = pred;
  }

  disponibles.innerHTML = futuros.map(p => {
    const yaAnalizado = !!predsMap[p.id];
    const flagL = getFlag(p.homeTeam?.name || '');
    const flagV = getFlag(p.awayTeam?.name || '');
    return `
      <button class="partido-btn ${yaAnalizado ? 'ya-analizado' : ''}"
              onclick="seleccionarPartido(${JSON.stringify(JSON.stringify(p))})">
        <div>
          <div class="partido-equipos">${flagL} ${p.homeTeam?.name} vs ${flagV} ${p.awayTeam?.name}</div>
          <div class="partido-info">${formatearFecha(p.utcDate)} · ${p.group ? 'Grupo ' + p.group : 'Mundial'}</div>
        </div>
        ${yaAnalizado
          ? `<span class="partido-tag" style="background:#052e16;color:#22c55e;border:1px solid #166534">✓ Analizado</span>`
          : `<span class="partido-tag" style="background:#0a1628;color:#3b82f6;border:1px solid #1e3a6e">Analizar</span>`
        }
      </button>
    `;
  }).join('');

  if (idParam) {
    const p = futuros.find(x => x.id.toString() === idParam);
    if (p) seleccionarPartido(JSON.stringify(p));
  }
}

window.seleccionarPartido = async function(partidoJson) {
  const partido = JSON.parse(partidoJson);
  partidoActual = partido;

  document.getElementById('partido-selector').style.display = 'none';
  document.getElementById('analisis-container').style.display = 'block';

  document.getElementById('flag-local').textContent = getFlag(partido.homeTeam?.name || '');
  document.getElementById('flag-visitante').textContent = getFlag(partido.awayTeam?.name || '');
  document.getElementById('nombre-local').textContent = partido.homeTeam?.name || 'Local';
  document.getElementById('nombre-visitante').textContent = partido.awayTeam?.name || 'Visitante';
  document.getElementById('matchup-info').textContent =
    `${formatearFecha(partido.utcDate)} · ${partido.group ? 'Grupo ' + partido.group : 'Mundial 2026'}`;
  document.getElementById('matchup-estadio').textContent = partido.venue || 'Estadio TBD';

  const existente = await getPrediccion(partido.id.toString());
  if (existente && existente.scores) {
    mostrarResultado(existente, true);
    return;
  }

  await correrAnalisis(partido);
};

async function correrAnalisis(partido) {
  document.getElementById('loading-analisis').style.display = 'block';
  document.getElementById('resultado-analisis').style.display = 'none';

  const setStep = (stepId, estado) => {
    const el = document.getElementById(stepId);
    if (!el) return;
    el.classList.remove('inactive', 'done');
    const icon = el.querySelector('.step-icon');
    if (estado === 'loading') { icon.className = 'step-icon loading'; }
    else if (estado === 'done') { icon.className = 'step-icon done'; el.classList.add('done'); }
    else { el.classList.add('inactive'); icon.className = 'step-icon'; }
  };

  try {
    setStep('step-stats', 'loading');
    const [statsLocal, statsVisitante] = await Promise.all([
      getStatsEquipo(partido.homeTeam?.id, partido.homeTeam?.name),
      getStatsEquipo(partido.awayTeam?.id, partido.awayTeam?.name),
    ]);
    setStep('step-stats', 'done');

    setStep('step-psico', 'loading');
    const jornada = inferirJornada(partido);
    const psicologico = await analizarPsicologiaClaude(
      partido.homeTeam?.name,
      partido.awayTeam?.name,
      jornada,
      partido.group || 'Grupos',
      new Date(partido.utcDate).toLocaleDateString('es-PE'),
    );
    setStep('step-psico', 'done');

    setStep('step-modelo', 'loading');
    const datosPart = {
      jornada,
      estadio: partido.venue || '',
      tipoLocalidad: 'local',
      rankingLocal: 24,
      rankingVisitante: 32,
      nombreLocal: partido.homeTeam?.name,
      nombreVisitante: partido.awayTeam?.name,
    };

    const resultado = await calcularPrediccion(datosPart, statsLocal, statsVisitante, psicologico);
    setStep('step-modelo', 'done');

    resultadoAnalisis = {
      id: partido.id.toString(),
      partido: datosPart,
      stats_local: statsLocal,
      stats_visitante: statsVisitante,
      psicologico,
      scores: resultado,
      apuestas: resultado.apuestas,
    };

    document.getElementById('loading-analisis').style.display = 'none';
    mostrarResultado(resultadoAnalisis, false);

  } catch (e) {
    console.error('Error en análisis:', e);
    document.getElementById('loading-analisis').innerHTML =
      `<div class="empty-state">Error al analizar: ${e.message}</div>`;
  }
}

function mostrarResultado(datos, esGuardado) {
  document.getElementById('resultado-analisis').style.display = 'block';

  const s = datos.scores;
  const nombreLocal = datos.partido.nombreLocal;
  const nombreVisitante = datos.partido.nombreVisitante;

  document.getElementById('score-local-nombre').textContent = nombreLocal;
  document.getElementById('score-visitante-nombre').textContent = nombreVisitante;

  const setBar = (id, valor, max = 10) => {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.min(100, (valor / max) * 100)}%`;
  };
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setBar('bar-stat-local', s.local.scoreStat);
  setBar('bar-psico-local', s.local.scorePsico);
  setBar('bar-boost-local', (s.local.boost - 0.9) * 100, 25);
  setVal('val-stat-local', s.local.scoreStat.toFixed(1));
  setVal('val-psico-local', s.local.scorePsico.toFixed(1));
  setVal('val-boost-local', `×${s.local.boost.toFixed(3)}`);
  setVal('score-total-local', s.local.total.toFixed(2));

  setBar('bar-stat-visitante', s.visitante.scoreStat);
  setBar('bar-psico-visitante', s.visitante.scorePsico);
  setBar('bar-boost-visitante', (s.visitante.boost - 0.9) * 100, 25);
  setVal('val-stat-visitante', s.visitante.scoreStat.toFixed(1));
  setVal('val-psico-visitante', s.visitante.scorePsico.toFixed(1));
  setVal('val-boost-visitante', `×${s.visitante.boost.toFixed(3)}`);
  setVal('score-total-visitante', s.visitante.total.toFixed(2));
  setVal('score-diff', s.diferencia.toFixed(2));

  const psicoGrid = document.getElementById('psico-grid');
  const p = datos.psicologico;
  if (p) {
    const vars = [
      { label: 'Necesita ganar', l: p.local?.necesita_ganar, v: p.visitante?.necesita_ganar, tipo: 'bool' },
      { label: 'Venganza narrativa', l: p.local?.venganza_narrativa, v: p.visitante?.venganza_narrativa, tipo: 'bool' },
      { label: 'Líder disponible', l: p.local?.lider_disponible, v: p.visitante?.lider_disponible, tipo: 'bool_inv' },
      { label: 'Underdog', l: p.local?.underdog, v: p.visitante?.underdog, tipo: 'bool' },
      { label: 'Conflicto interno', l: p.local?.conflicto_interno, v: p.visitante?.conflicto_interno, tipo: 'num_neg' },
      { label: 'Presión mediática', l: p.local?.presion_mediatica, v: p.visitante?.presion_mediatica, tipo: 'num_neg' },
    ];
    psicoGrid.innerHTML = vars.map(v => `
      <div class="psico-item">
        <span class="psico-label">${v.label}</span>
        <div class="psico-team-vals">
          <span class="psico-val ${psicoColor(v.l, v.tipo)}" title="${nombreLocal}">${psicoVal(v.l)}</span>
          <span class="psico-val ${psicoColor(v.v, v.tipo)}" title="${nombreVisitante}">${psicoVal(v.v)}</span>
        </div>
      </div>
    `).join('');
  }

  const narrativaBox = document.getElementById('narrativa-box');
  if (p?.narrativa) narrativaBox.textContent = p.narrativa;

  const apuestasGrid = document.getElementById('apuestas-grid');
  if (s.apuestas && s.apuestas.length > 0) {
    apuestasGrid.innerHTML = s.apuestas.map(ap => `
      <div class="apuesta-card ${ap.tipo}">
        <span class="apuesta-tipo ${ap.tipo}">${ap.tipo.toUpperCase()}</span>
        <div class="apuesta-body">
          <div class="apuesta-mercado">${ap.mercado}</div>
          <div class="apuesta-razon">${ap.razon}</div>
        </div>
        <div class="apuesta-nums">
          <div class="apuesta-cuota">~${ap.cuota_estimada}</div>
          <div class="apuesta-conf">${Math.round(ap.confianza * 100)}% confianza</div>
          <div class="apuesta-ev ${ap.EV > 0 ? 'pos' : 'neg'}">EV: ${ap.EV > 0 ? '+' : ''}${ap.EV.toFixed(3)}</div>
        </div>
      </div>
    `).join('');
  } else {
    apuestasGrid.innerHTML = `<div class="empty-state">No se encontraron apuestas con valor positivo para este partido.</div>`;
  }

  const actionInfo = document.getElementById('action-info');
  if (esGuardado) {
    actionInfo.textContent = '✓ Predicción guardada en Firebase';
    document.getElementById('btn-guardar').textContent = '✓ Ya guardada';
    document.getElementById('btn-guardar').disabled = true;
  } else {
    actionInfo.textContent = 'Guardá la predicción antes de que empiece el partido';
  }
}

window.guardarPrediccion = async function() {
  if (!resultadoAnalisis) return;
  const btn = document.getElementById('btn-guardar');
  btn.textContent = 'Guardando...';
  btn.disabled = true;

  const ok = await guardarPrediccion(resultadoAnalisis.id, resultadoAnalisis);
  if (ok) {
    btn.textContent = '✓ Guardada';
    document.getElementById('action-info').textContent = '✓ Predicción guardada en Firebase correctamente';
  } else {
    btn.textContent = '💾 Guardar predicción';
    btn.disabled = false;
    alert('Error guardando. Verificá la conexión.');
  }
};

function inferirJornada(partido) {
  const date = new Date(partido.utcDate);
  const inicio = new Date('2026-06-11');
  const dias = Math.floor((date - inicio) / (1000 * 60 * 60 * 24));
  if (dias < 8) return 1;
  if (dias < 16) return 2;
  return 3;
}

function psicoVal(v) {
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'number') return v.toString();
  return v || '—';
}

function psicoColor(v, tipo) {
  if (tipo === 'bool') return v ? 'pos' : 'neu';
  if (tipo === 'bool_inv') return v ? 'neu' : 'neg';
  if (tipo === 'num_neg') return v > 1 ? 'neg' : 'neu';
  return 'neu';
}

async function cargarMetricasNav() {
  try {
    const m = await calcularMetricas();
    const total = m.seguras.total + m.medias.total + m.malcriadas.total;
    const acertadas = m.seguras.acertadas + m.medias.acertadas + m.malcriadas.acertadas;
    if (total > 0) {
      document.getElementById('precision-global').textContent =
        Math.round((acertadas / total) * 100) + '%';
    }
  } catch (e) {}
}

init();
