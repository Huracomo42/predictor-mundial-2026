import { getTodasPredicciones, guardarResultado, calcularMetricas } from './firebase-db.js';

let todasPredicciones = [];
let partidoModalActual = null;

async function init() {
  await cargarMetricas();
  await cargarHistorial();
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
    document.getElementById('historial-count').textContent =
      `${todasPredicciones.length} partido${todasPredicciones.length !== 1 ? 's' : ''} analizado${todasPredicciones.length !== 1 ? 's' : ''}`;
    renderHistorial(todasPredicciones);
  } catch (e) {
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
    const tieneResultado = !!p.resultado_real;
    const gL = tieneResultado ? p.resultado_real.goles_local : '?';
    const gV = tieneResultado ? p.resultado_real.goles_visitante : '?';

    const apuestasHTML = (p.apuestas || []).map(ap => {
      let resultClass = 'hist-pending';
      let resultText = '⏳ Pendiente';
      if (ap.entro === true) { resultClass = 'hist-hit'; resultText = '✓ Entró'; }
      if (ap.entro === false) { resultClass = 'hist-miss'; resultText = '✗ Falló'; }
      return `
        <div class="hist-apuesta">
          <span class="hist-label">${ap.tipo.toUpperCase()} · ${ap.mercado} (~${ap.cuota_estimada})</span>
          <span class="${resultClass}">${resultText}</span>
        </div>
      `;
    }).join('');

    const btnResultado = !tieneResultado
      ? `<button class="btn-ingresar-resultado" onclick="abrirModal('${p.id}', '${p.partido?.nombreLocal}', '${p.partido?.nombreVisitante}')">
           Ingresar resultado
         </button>`
      : `<span style="font-size:11px;color:var(--text3)">Resultado ingresado</span>`;

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
          </div>
          <div class="historial-resultado">${gL} — ${gV}</div>
          <div>
            <div style="font-size:11px;color:var(--text2);margin-bottom:4px">
              Score: ${p.scores?.local?.total?.toFixed(1) || '—'} vs ${p.scores?.visitante?.total?.toFixed(1) || '—'}
            </div>
            ${btnResultado}
          </div>
        </div>
        <div class="historial-apuestas">${apuestasHTML}</div>
      </div>
    `;
  }).join('');
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
