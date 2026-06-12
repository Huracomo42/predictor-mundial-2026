import { getPesos, guardarPesos, getVersionesModelo, getTodasPredicciones, calcularMetricas } from './firebase-db.js';
import { PESOS_DEFAULT } from './config.js';

let pesosActuales = { ...PESOS_DEFAULT, version: '1.0' };

async function init() {
  pesosActuales = await getPesos();
  aplicarPesosUI(pesosActuales);
  await cargarVersiones();
  await verificarCalibrador();
  cargarMetricasNav();
}

function aplicarPesosUI(pesos) {
  document.getElementById('peso-stat').value = Math.round(pesos.estadistico * 100);
  document.getElementById('peso-presion').value = Math.round(pesos.categorias.presion * 100);
  document.getElementById('peso-local').value = Math.round(pesos.categorias.local * 100);
  document.getElementById('peso-liderazgo').value = Math.round(pesos.categorias.liderazgo * 100);
  document.getElementById('peso-momentum').value = Math.round(pesos.categorias.momentum * 100);
  actualizarPesos();
}

window.actualizarPesos = function() {
  const stat = parseInt(document.getElementById('peso-stat').value);
  const psico = 100 - stat;
  const presion = parseInt(document.getElementById('peso-presion').value);
  const local = parseInt(document.getElementById('peso-local').value);
  const liderazgo = parseInt(document.getElementById('peso-liderazgo').value);
  const momentum = parseInt(document.getElementById('peso-momentum').value);
  const totalCat = presion + local + liderazgo + momentum;

  document.getElementById('peso-stat-val').textContent = stat + '%';
  document.getElementById('peso-psico-val').textContent = psico + '%';
  document.getElementById('peso-presion-val').textContent = presion + '%';
  document.getElementById('peso-local-val').textContent = local + '%';
  document.getElementById('peso-liderazgo-val').textContent = liderazgo + '%';
  document.getElementById('peso-momentum-val').textContent = momentum + '%';

  const warning = document.getElementById('peso-warning');
  if (Math.abs(totalCat - psico) > 2) {
    warning.style.display = 'block';
    warning.textContent = `⚠️ Las categorías psicológicas suman ${totalCat}% pero el peso psicológico es ${psico}%. Ajustá los sliders.`;
  } else {
    warning.style.display = 'none';
  }
};

window.guardarPesos = async function() {
  const stat = parseInt(document.getElementById('peso-stat').value) / 100;
  const presion = parseInt(document.getElementById('peso-presion').value) / 100;
  const local = parseInt(document.getElementById('peso-local').value) / 100;
  const liderazgo = parseInt(document.getElementById('peso-liderazgo').value) / 100;
  const momentum = parseInt(document.getElementById('peso-momentum').value) / 100;

  const versiones = await getVersionesModelo();
  const ultimaVersion = versiones.length > 0
    ? parseFloat(versiones[0].version.replace('v', '')) + 0.1
    : 1.1;
  const nuevaVersion = `v${ultimaVersion.toFixed(1)}`;

  const nuevosPesos = {
    estadistico: stat,
    psicologico: 1 - stat,
    categorias: { presion, local, liderazgo, momentum },
    version: nuevaVersion,
  };

  const ok = await guardarPesos(nuevosPesos, nuevaVersion);
  if (ok) {
    document.getElementById('modelo-badge').textContent = `Modelo ${nuevaVersion}`;
    pesosActuales = nuevosPesos;
    await cargarVersiones();
    alert(`✓ Pesos guardados como ${nuevaVersion}`);
  } else {
    alert('Error guardando pesos. Verificá la conexión.');
  }
};

window.resetearPesos = function() {
  if (confirm('¿Resetear a los pesos originales v1.0?')) {
    aplicarPesosUI(PESOS_DEFAULT);
  }
};

async function cargarVersiones() {
  const lista = document.getElementById('versiones-list');
  try {
    const versiones = await getVersionesModelo();
    if (versiones.length === 0) {
      lista.innerHTML = `
        <div class="version-item active">
          <div>
            <div class="version-name">v1.0 (inicial)</div>
            <div class="version-date">Pesos definidos manualmente · stat 60% / psico 40%</div>
          </div>
          <div class="version-precision">—</div>
        </div>
      `;
      return;
    }
    const metricas = await calcularMetricas();
    const total = metricas.seguras.total + metricas.medias.total + metricas.malcriadas.total;
    const acertadas = metricas.seguras.acertadas + metricas.medias.acertadas + metricas.malcriadas.acertadas;
    const precision = total > 0 ? Math.round((acertadas / total) * 100) + '%' : '—';

    lista.innerHTML = versiones.map((v, i) => `
      <div class="version-item ${i === 0 ? 'active' : ''}">
        <div>
          <div class="version-name">${v.version} ${i === 0 ? '(activa)' : ''}</div>
          <div class="version-date">
            stat ${Math.round((v.pesos?.estadistico || 0.6) * 100)}% / 
            psico ${Math.round((v.pesos?.psicologico || 0.4) * 100)}%
          </div>
        </div>
        <div class="version-precision">${i === 0 ? precision : '—'}</div>
      </div>
    `).join('');
  } catch (e) {
    lista.innerHTML = `<div class="empty-state">Error cargando versiones.</div>`;
  }
}

async function verificarCalibrador() {
  const predicciones = await getTodasPredicciones();
  const conResultado = predicciones.filter(p => p.resultado_real);
  const n = conResultado.length;

  const badge = document.getElementById('calibracion-status');
  const texto = document.getElementById('partidos-para-calibrar');

  if (n < 20) {
    texto.textContent = `${n}/20 partidos con resultado. Calibración automática con 20+.`;
  } else {
    badge.classList.add('activo');
    texto.textContent = `✓ ${n} partidos — calibración automática disponible`;
    await generarSugerencias(conResultado);
  }

  await calcularBoostReal(conResultado);
  await calcularImpactoVariables(conResultado);
}

async function generarSugerencias(conResultado) {
  const seccion = document.getElementById('sugerencias-section');
  const lista = document.getElementById('sugerencias-list');
  document.getElementById('n-partidos-calibracion').textContent = conResultado.length;

  const impactos = calcularImpactoPorVariable(conResultado);
  const sugerencias = [];

  Object.entries(impactos).forEach(([variable, data]) => {
    if (data.n < 5) return;
    const precision = data.aciertos / data.n;
    if (precision > 0.70) {
      sugerencias.push({ variable, precision, cambio: 'aumentar', razon: `Predice correctamente en ${Math.round(precision * 100)}% de los casos (${data.n} partidos)` });
    } else if (precision < 0.35) {
      sugerencias.push({ variable, precision, cambio: 'reducir', razon: `Solo predice correctamente en ${Math.round(precision * 100)}% de los casos (${data.n} partidos)` });
    }
  });

  if (sugerencias.length === 0) {
    lista.innerHTML = `<div class="empty-state">Los pesos actuales están bien calibrados con los datos disponibles.</div>`;
  } else {
    lista.innerHTML = sugerencias.map(s => `
      <div class="sugerencia-item">
        <div class="sugerencia-var">${s.variable}</div>
        <div class="sugerencia-cambio">→ ${s.cambio === 'aumentar' ? '↑ Aumentar peso' : '↓ Reducir peso'}</div>
        <div class="sugerencia-razon">${s.razon}</div>
      </div>
    `).join('');
  }

  seccion.style.display = 'block';
}

window.aplicarSugerencias = async function() {
  alert('Función disponible en próxima versión. Por ahora ajustá los sliders manualmente.');
};

async function calcularBoostReal(conResultado) {
  if (conResultado.length === 0) return;

  const equiposBoost = {};
  conResultado.forEach(p => {
    if (!p.resultado_real?.xg_local || !p.stats_local?.xg_promedio) return;
    const equipo = p.partido?.nombreLocal;
    if (!equiposBoost[equipo]) equiposBoost[equipo] = { xg_pre: [], xg_real: [] };
    equiposBoost[equipo].xg_pre.push(p.stats_local.xg_promedio);
    equiposBoost[equipo].xg_real.push(p.resultado_real.xg_local);
  });

  const boosts = Object.entries(equiposBoost)
    .filter(([_, d]) => d.xg_pre.length > 0)
    .map(([equipo, d]) => {
      const promPre = d.xg_pre.reduce((a, b) => a + b, 0) / d.xg_pre.length;
      const promReal = d.xg_real.reduce((a, b) => a + b, 0) / d.xg_real.length;
      return promPre > 0 ? promReal / promPre : 1.0;
    });

  if (boosts.length > 0) {
    const promBoost = boosts.reduce((a, b) => a + b, 0) / boosts.length;
    document.getElementById('boost-coef-val').textContent = `×${promBoost.toFixed(3)} (${boosts.length} equipos)`;
  }
}

async function calcularImpactoVariables(conResultado) {
  const container = document.getElementById('impacto-variables');
  if (conResultado.length < 10) return;

  const impactos = calcularImpactoPorVariable(conResultado);
  container.innerHTML = Object.entries(impactos)
    .filter(([_, d]) => d.n >= 3)
    .sort((a, b) => Math.abs(b[1].correlacion) - Math.abs(a[1].correlacion))
    .map(([variable, data]) => {
      const corr = data.correlacion;
      const clase = corr > 0.1 ? 'pos' : corr < -0.1 ? 'neg' : '';
      return `
        <div class="impacto-var">
          <span class="impacto-nombre">${variable}</span>
          <span class="impacto-corr ${clase}">${corr > 0 ? '+' : ''}${corr.toFixed(2)} (n=${data.n})</span>
        </div>
      `;
    }).join('');
}

function calcularImpactoPorVariable(conResultado) {
  const vars = {
    'Necesita ganar': { campo: 'necesita_ganar', n: 0, aciertos: 0, correlacion: 0 },
    'Venganza narrativa': { campo: 'venganza_narrativa', n: 0, aciertos: 0, correlacion: 0 },
    'Líder disponible': { campo: 'lider_disponible', n: 0, aciertos: 0, correlacion: 0 },
    'Underdog': { campo: 'underdog', n: 0, aciertos: 0, correlacion: 0 },
  };

  conResultado.forEach(p => {
    const apAcertadas = (p.apuestas || []).filter(ap => ap.entro === true).length;
    const apTotal = (p.apuestas || []).filter(ap => ap.entro !== null && ap.entro !== undefined).length;
    if (apTotal === 0) return;
    const precision = apAcertadas / apTotal;

    Object.entries(vars).forEach(([nombre, datos]) => {
      const val = p.psicologico?.local?.[datos.campo];
      if (val !== undefined && val !== null) {
        datos.n++;
        if (val === true || val > 0) datos.aciertos++;
        datos.correlacion += (val ? 1 : -1) * (precision - 0.5);
      }
    });
  });

  Object.values(vars).forEach(d => {
    if (d.n > 0) d.correlacion = d.correlacion / d.n;
  });

  return vars;
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
