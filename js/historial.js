import {
  getTodasPredicciones,
  guardarResultado,
  calcularMetricas,
  getStatsAvanzadasBatch
} from './firebase-db.js';

let todasPredicciones = [];
let partidoModalActual = null;

const SYNC_ADVANCED_STATS_URL =
  'https://us-central1-predictor-mundial-2026-cfbfe.cloudfunctions.net/syncAdvancedStats';


async function init() {
  configurarSyncFotmob();
  await cargarMetricas();
  await cargarHistorial();
}

function configurarSyncFotmob() {
  const btn = document.getElementById('btn-sync-fotmob');
  const inputFecha = document.getElementById('fecha-sync-fotmob');
  const status = document.getElementById('sync-fotmob-status');

  if (!btn || !inputFecha || !status) return;

  inputFecha.value = new Date().toISOString().slice(0, 10);

  btn.addEventListener('click', async () => {
    const fecha = inputFecha.value;

    if (!fecha) {
      status.textContent = 'Selecciona una fecha.';
      status.className = 'sync-fotmob-status error';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Actualizando...';
    status.textContent = 'Sincronizando FotMob...';
    status.className = 'sync-fotmob-status loading';

    try {
      const res = await fetch(`${SYNC_ADVANCED_STATS_URL}?date=${fecha}`);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'syncAdvancedStats respondió sin ok=true');
      }

      const guardados = Array.isArray(data.resultados)
        ? data.resultados.filter(r => r.estado === 'guardado').length
        : 0;

      status.textContent = `FotMob actualizado: ${guardados} partido(s) guardado(s).`;
      status.className = 'sync-fotmob-status ok';

      await cargarHistorial();
      await cargarMetricas();

    } catch (e) {
      console.error('Error sincronizando FotMob:', e);
      status.textContent = 'Error sincronizando FotMob. Revisa consola.';
      status.className = 'sync-fotmob-status error';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Actualizar stats FotMob';
    }
  });
}

async function cargarMetricas() {
  try {
    const m = await calcularMetricas();

    const fmt = (acert, total) => total > 0
      ? { pct: Math.round((acert / total) * 100) + '%', fill: Math.round((acert / total) * 100) }
      : { pct: '—', fill: 0 };

    const s = fmt(m.seguras.acertadas, m.seguras.total);
    const med = fmt(m.medias.acertadas, m.medias.total);
    const mal = fmt(m.malcriadas.acertadas, m.malcriadas.total);

    document.getElementById('pct-seguras').textContent = s.pct;
    document.getElementById('pct-medias').textContent = med.pct;
    document.getElementById('pct-malcriadas').textContent = mal.pct;
    document.getElementById('count-seguras').textContent = `${m.seguras.acertadas}/${m.seguras.total}`;
    document.getElementById('count-medias').textContent = `${m.medias.acertadas}/${m.medias.total}`;
    document.getElementById('count-malcriadas').textContent = `${m.malcriadas.acertadas}/${m.malcriadas.total}`;
    document.getElementById('fill-seguras').style.width = s.fill + '%';
    document.getElementById('fill-medias').style.width = med.fill + '%';
    document.getElementById('fill-malcriadas').style.width = mal.fill + '%';
    document.getElementById('count-total').textContent = `${m.con_resultado} partidos con resultado`;

    if (m.ev_count > 0) {
      const ev = m.ev_total / m.ev_count;
      document.getElementById('ev-promedio').textContent = (ev > 0 ? '+' : '') + ev.toFixed(3);
      document.getElementById('fill-ev').style.width = Math.min(100, Math.max(0, (ev + 0.2) * 200)) + '%';
    }

    const total = m.seguras.total + m.medias.total + m.malcriadas.total;
    const acertadas = m.seguras.acertadas + m.medias.acertadas + m.malcriadas.acertadas;
    if (total > 0) {
      document.getElementById('precision-global').textContent =
        Math.round((acertadas / total) * 100) + '%';
    }
  } catch (e) {
    console.error('Error métricas:', e);
  }
}

async function cargarHistorial() {
  const container = document.getElementById('historial-container');

  try {
    todasPredicciones = await getTodasPredicciones();

    const ids = todasPredicciones.map(p => p.id);
    const statsPorPartido = await getStatsAvanzadasBatch(ids);

    todasPredicciones = todasPredicciones.map(p => ({
      ...p,
      stats_fotmob: statsPorPartido[p.id] || null,
    }));

    document.getElementById('historial-count').textContent =
      `${todasPredicciones.length} partido${todasPredicciones.length !== 1 ? 's' : ''} analizado${todasPredicciones.length !== 1 ? 's' : ''}`;

    renderHistorial(todasPredicciones);
  } catch (e) {
    console.error('Error cargando historial:', e);
    container.innerHTML = `<div class="empty-state">Error cargando historial.</div>`;
  }
}

function renderHistorial(predicciones) {
  const container = document.getElementById('historial-container');

  if (predicciones.length === 0) {
    container.innerHTML = `<div class="empty-state">Aún no hay predicciones guardadas.<br>Analizá un partido para empezar.</div>`;
    return;
  }

  container.innerHTML = predicciones.map(p => {
    const statsDoc = p.stats_fotmob;
    const stats = statsDoc?.stats_avanzadas || null;
    const resultadoFotmob = statsDoc?.resultado_real || null;

    const tieneResultado = !!(resultadoFotmob || p.resultado_real);
    const resultado = resultadoFotmob || p.resultado_real || null;

    const gL = tieneResultado ? resultado.goles_local : '?';
    const gV = tieneResultado ? resultado.goles_visitante : '?';

    const scoreLocal = p.scores?.local?.total ?? null;
    const scoreVisitante = p.scores?.visitante?.total ?? null;
    const ganadorModelo = calcularGanadorModelo(scoreLocal, scoreVisitante);
    const ganadorReal = resultado?.ganador || calcularGanadorReal(gL, gV);
    const aciertoGanador = tieneResultado && ganadorModelo
      ? ganadorModelo === ganadorReal
      : null;

    const evaluacionHTML = tieneResultado
      ? `
        <div class="hist-eval ${aciertoGanador ? 'ok' : 'bad'}">
          ${aciertoGanador ? '✓ Ganador acertado' : '✗ Ganador fallado'}
        </div>
      `
      : `<div class="hist-eval pending">Pendiente</div>`;

    const statsHTML = stats
      ? `
        <div class="stats-grid-mini">
          <div><span>xG</span><strong>${fmt(stats.xg_local)} - ${fmt(stats.xg_visitante)}</strong></div>
          <div><span>Tiros</span><strong>${fmt(stats.tiros_local)} - ${fmt(stats.tiros_visitante)}</strong></div>
          <div><span>Al arco</span><strong>${fmt(stats.tiros_puerta_local)} - ${fmt(stats.tiros_puerta_visitante)}</strong></div>
          <div><span>Corners</span><strong>${fmt(stats.corners_local)} - ${fmt(stats.corners_visitante)}</strong></div>
          <div><span>Amarillas</span><strong>${fmt(stats.amarillas_local)} - ${fmt(stats.amarillas_visitante)}</strong></div>
          <div><span>Rojas</span><strong>${fmt(stats.rojas_local)} - ${fmt(stats.rojas_visitante)}</strong></div>
          <div><span>Posesión</span><strong>${fmt(stats.posesion_local)}% - ${fmt(stats.posesion_visitante)}%</strong></div>
          <div><span>Big chances</span><strong>${fmt(stats.grandes_ocaciones_local)} - ${fmt(stats.grandes_ocaciones_visitante)}</strong></div>
        </div>
      `
      : `
        <div class="stats-missing">
          Sin stats avanzadas FotMob todavía.
        </div>
      `;

    const contextoHTML = statsDoc?.contexto_partido
      ? `
        <div class="hist-contexto">
          ${statsDoc.contexto_partido.estadio || 'Estadio —'} · 
          Árbitro: ${statsDoc.contexto_partido.arbitro || '—'} · 
          Asistencia: ${statsDoc.contexto_partido.asistencia || '—'}
        </div>
      `
      : '';

    const apuestasValidas = Array.isArray(p.apuestas)
  ? p.apuestas.filter(ap => ap && typeof ap === 'object')
  : [];

const apuestasHTML = apuestasValidas.length > 0
  ? apuestasValidas.map(ap => {
      let resultClass = 'hist-pending';
      let resultText = '⏳ Pendiente';

      if (ap.entro === true) {
        resultClass = 'hist-hit';
        resultText = '✓ Entró';
      }

      if (ap.entro === false) {
        resultClass = 'hist-miss';
        resultText = '✗ Falló';
      }

      const tipo = ap.tipo ? String(ap.tipo).toUpperCase() : 'SIN TIPO';
      const mercado = ap.mercado || 'Mercado no definido';
      const cuota = ap.cuota_estimada || '—';

      return `
        <div class="hist-apuesta">
          <span class="hist-label">${tipo} · ${mercado} (~${cuota})</span>
          <span class="${resultClass}">${resultText}</span>
        </div>
      `;
    }).join('')
  : `
    <div class="hist-apuesta">
      <span class="hist-label">Sin apuestas registradas para esta predicción</span>
      <span class="hist-pending">—</span>
    </div>
  `;

    const fuenteResultado = resultadoFotmob
      ? `<span class="fuente-fotmob">Resultado y stats vía FotMob</span>`
      : tieneResultado
        ? `<span class="fuente-manual">Resultado manual</span>`
        : `<span class="fuente-pendiente">Sin resultado</span>`;

    const btnResultado = !tieneResultado
      ? `<button class="btn-ingresar-resultado" onclick="abrirModal('${p.id}', '${p.partido?.nombreLocal}', '${p.partido?.nombreVisitante}')">
           Ingresar manual
         </button>`
      : '';

    return `
      <div class="historial-item">
        <div class="historial-header">
          <div>
            <div class="historial-partido">
              ${p.partido?.nombreLocal || '—'} vs ${p.partido?.nombreVisitante || '—'}
            </div>
            <div class="historial-fecha">
              ${p.guardado_en?.toDate ? p.guardado_en.toDate().toLocaleDateString('es-PE') : '—'} · 
              Modelo v${p.scores?.version_modelo || '1.0'}
            </div>
            <div class="historial-fecha">${fuenteResultado}</div>
          </div>

          <div class="historial-resultado">${gL} — ${gV}</div>

          <div>
            <div style="font-size:11px;color:var(--text2);margin-bottom:4px">
              Score: ${scoreLocal !== null ? scoreLocal.toFixed(1) : '—'} vs ${scoreVisitante !== null ? scoreVisitante.toFixed(1) : '—'}
            </div>
            ${evaluacionHTML}
            ${btnResultado}
          </div>
        </div>

        ${contextoHTML}

        <div class="historial-advanced">
          ${statsHTML}
        </div>

        <div class="historial-apuestas">${apuestasHTML}</div>
      </div>
    `;
  }).join('');
}

function calcularGanadorModelo(scoreLocal, scoreVisitante) {
  if (scoreLocal === null || scoreLocal === undefined) return null;
  if (scoreVisitante === null || scoreVisitante === undefined) return null;

  if (scoreLocal > scoreVisitante) return 'local';
  if (scoreVisitante > scoreLocal) return 'visitante';
  return 'empate';
}

function calcularGanadorReal(golesLocal, golesVisitante) {
  if (golesLocal === '?' || golesVisitante === '?') return null;

  const gl = Number(golesLocal);
  const gv = Number(golesVisitante);

  if (gl > gv) return 'local';
  if (gv > gl) return 'visitante';
  return 'empate';
}

function fmt(valor) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';

  if (typeof valor === 'number') {
    return Number.isInteger(valor) ? valor : valor.toFixed(2);
  }

  return valor;
}

window.filtrarHistorial = function() {
  const tipo = document.getElementById('filter-tipo').value;
  const resultado = document.getElementById('filter-resultado').value;

  let filtradas = [...todasPredicciones];

  if (tipo !== 'todos') {
    filtradas = filtradas.filter(p =>
      (p.apuestas || []).some(ap => ap.tipo === tipo)
    );
  }

  if (resultado !== 'todos') {
    filtradas = filtradas.filter(p => {
      if (resultado === 'pendiente') return !p.resultado_real;
      if (resultado === 'acierto') return (p.apuestas || []).some(ap => ap.entro === true);
      if (resultado === 'fallo') return (p.apuestas || []).some(ap => ap.entro === false);
      return true;
    });
  }

  renderHistorial(filtradas);
};

window.abrirModal = function(partidoId, nombreLocal, nombreVisitante) {
  partidoModalActual = partidoId;
  document.getElementById('modal-local').textContent = nombreLocal;
  document.getElementById('modal-visitante').textContent = nombreVisitante;
  document.getElementById('modal-titulo').textContent = `Resultado: ${nombreLocal} vs ${nombreVisitante}`;
  document.getElementById('modal-resultado').style.display = 'flex';
};

window.cerrarModal = function() {
  document.getElementById('modal-resultado').style.display = 'none';
  partidoModalActual = null;
};

window.guardarResultado = async function() {
  if (!partidoModalActual) return;

  const resultado = {
    goles_local: parseInt(document.getElementById('goles-local').value) || 0,
    goles_visitante: parseInt(document.getElementById('goles-visitante').value) || 0,
    corners_totales: parseInt(document.getElementById('corners-reales').value) || 0,
    amarillas_visitante: parseInt(document.getElementById('amarillas-visitante').value) || 0,
    xg_local: parseFloat(document.getElementById('xg-local-real').value) || null,
    xg_visitante: parseFloat(document.getElementById('xg-visitante-real').value) || null,
  };

  const ok = await guardarResultado(partidoModalActual, resultado);
  if (ok) {
    cerrarModal();
    await cargarHistorial();
    await cargarMetricas();
  } else {
    alert('Error guardando resultado. Verificá la conexión.');
  }
};

init();
