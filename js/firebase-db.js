import { db } from './firebase-init.js';
import {
  collection, doc, setDoc, getDoc, getDocs,
  query, orderBy, where, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { PESOS_DEFAULT } from './config.js';

export async function guardarPrediccion(partidoId, datos) {
  try {
    await setDoc(doc(db, 'predicciones', partidoId), {
      ...datos,
      guardado_en: serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error('Error guardando predicción:', e);
    return false;
  }
}

export async function getPrediccion(partidoId) {
  try {
    const snap = await getDoc(doc(db, 'predicciones', partidoId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (e) {
    console.error('Error leyendo predicción:', e);
    return null;
  }
}

export async function getTodasPredicciones() {
  try {
    const snap = await getDocs(
      query(collection(db, 'predicciones'), orderBy('guardado_en', 'desc'))
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Error leyendo predicciones:', e);
    return [];
  }
}

export async function guardarResultado(partidoId, resultado) {
  try {
    const predRef = doc(db, 'predicciones', partidoId);
    const predSnap = await getDoc(predRef);

    if (!predSnap.exists()) {
      console.error('No existe predicción para este partido');
      return false;
    }

    const pred = predSnap.data();
    const apuestasActualizadas = evaluarApuestas(pred.apuestas || [], resultado);

    await updateDoc(predRef, {
      resultado_real: resultado,
      apuestas: apuestasActualizadas,
      resultado_ingresado_en: serverTimestamp(),
    });

    await actualizarBoostMundialista(pred.partido?.nombreLocal, resultado.xg_local, pred.stats_local?.xg_promedio);
    await actualizarBoostMundialista(pred.partido?.nombreVisitante, resultado.xg_visitante, pred.stats_visitante?.xg_promedio);

    return true;
  } catch (e) {
    console.error('Error guardando resultado:', e);
    return false;
  }
}

function evaluarApuestas(apuestas, resultado) {
  return apuestas.map(ap => {
    let entro = null;
    const goles = resultado.goles_local + resultado.goles_visitante;
    const corners = resultado.corners_totales;
    const amarillasVisitante = resultado.amarillas_visitante;

    if (ap.mercado.includes('Menos de 2.5 goles')) {
      entro = goles < 2.5;
    } else if (ap.mercado.includes('Menos de 9.5 córners')) {
      entro = corners < 9.5;
    } else if (ap.mercado.includes('+1.5 tarjetas')) {
      entro = amarillasVisitante >= 2;
    } else if (ap.mercado.includes('gana o empata')) {
      const esLocal = ap.mercado.includes('1X');
      if (esLocal) entro = resultado.goles_local >= resultado.goles_visitante;
      else entro = resultado.goles_visitante >= resultado.goles_local;
    } else if (ap.mercado.includes('1-0')) {
      entro = resultado.goles_local === 1 && resultado.goles_visitante === 0;
    } else if (ap.mercado.includes('0-1')) {
      entro = resultado.goles_local === 0 && resultado.goles_visitante === 1;
    }

    return { ...ap, entro };
  });
}

async function actualizarBoostMundialista(equipo, xgReal, xgPreTorneo) {
  if (!equipo || !xgReal || !xgPreTorneo) return;
  try {
    const ref = doc(db, 'boost_mundialista', equipo.replace(/\s+/g, '_'));
    const snap = await getDoc(ref);
    const existing = snap.exists() ? snap.data() : { partidos: [] };

    existing.partidos.push({ xg_real: xgReal, xg_pre: xgPreTorneo });

    const boostReal = existing.partidos.length > 0
      ? existing.partidos.reduce((acc, p) => acc + (p.xg_real / p.xg_pre), 0) / existing.partidos.length
      : 1.0;

    await setDoc(ref, {
      equipo,
      xg_pre_torneo: xgPreTorneo,
      xg_promedio_torneo: existing.partidos.reduce((a, p) => a + p.xg_real, 0) / existing.partidos.length,
      boost_calculado: Math.round(boostReal * 1000) / 1000,
      partidos: existing.partidos,
      actualizado_en: serverTimestamp(),
    });
  } catch (e) {
    console.error('Error actualizando boost:', e);
  }
}

export async function getBoostMundialista() {
  try {
    const snap = await getDocs(collection(db, 'boost_mundialista'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    return [];
  }
}

export async function getPesos() {
  try {
    const snap = await getDoc(doc(db, 'modelo_versiones', 'activa'));
    if (snap.exists()) return snap.data().pesos;
    return { ...PESOS_DEFAULT, version: '1.0' };
  } catch (e) {
    return { ...PESOS_DEFAULT, version: '1.0' };
  }
}

export async function guardarPesos(pesos, version) {
  try {
    await setDoc(doc(db, 'modelo_versiones', version), {
      version,
      pesos,
      guardado_en: serverTimestamp(),
    });
    await setDoc(doc(db, 'modelo_versiones', 'activa'), {
      version,
      pesos,
      guardado_en: serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error('Error guardando pesos:', e);
    return false;
  }
}

export async function getVersionesModelo() {
  try {
    const snap = await getDocs(
      query(collection(db, 'modelo_versiones'), orderBy('guardado_en', 'desc'))
    );
    return snap.docs
      .filter(d => d.id !== 'activa')
      .map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    return [];
  }
}

export async function calcularMetricas() {
  const predicciones = await getTodasPredicciones();
  const ids = predicciones.map(p => p.id);
  const statsPorPartido = await getStatsAvanzadasBatch(ids);

  const metricas = {
    total: predicciones.length,
    con_resultado: 0,
    seguras: { total: 0, acertadas: 0 },
    medias: { total: 0, acertadas: 0 },
    malcriadas: { total: 0, acertadas: 0 },
    ev_total: 0,
    ev_count: 0,
  };

  predicciones.forEach(p => {
    const stats = statsPorPartido[p.id] || null;
    const resultado = obtenerResultadoRealParaMetricas(p, stats);

    if (!resultado) return;

    metricas.con_resultado++;

    const apuestas = Array.isArray(p.apuestas)
      ? p.apuestas.filter(ap => ap && typeof ap === 'object')
      : [];

    apuestas.forEach(ap => {
      if (ap.entro === null || ap.entro === undefined) return;

      const tipo = ap.tipo;
      const bucket = tipo ? `${tipo}s` : null;

      if (bucket && metricas[bucket]) {
        metricas[bucket].total++;

        if (ap.entro === true) {
          metricas[bucket].acertadas++;
        }
      }

      if (ap.EV !== null && ap.EV !== undefined) {
        metricas.ev_total += Number(ap.EV) || 0;
        metricas.ev_count++;
      }
    });
  });

  return metricas;
}

export async function actualizarEvaluacionApuestasConFotmob() {
  try {
    const predicciones = await getTodasPredicciones();
    const ids = predicciones.map(p => p.id);
    const statsPorPartido = await getStatsAvanzadasBatch(ids);

    let actualizadas = 0;

    for (const p of predicciones) {
      const statsDoc = statsPorPartido[p.id];

      if (!statsDoc?.resultado_real || !statsDoc?.stats_avanzadas) continue;

      const apuestas = Array.isArray(p.apuestas)
        ? p.apuestas.filter(ap => ap && typeof ap === 'object')
        : [];

      if (apuestas.length === 0) continue;

      const resultado = construirResultadoDesdeFotmob(statsDoc);
      const apuestasEvaluadas = evaluarApuestas(apuestas, resultado);

      await updateDoc(doc(db, 'predicciones', p.id), {
        apuestas: apuestasEvaluadas,
        evaluado_con_fotmob_en: serverTimestamp(),
      });

      actualizadas++;
    }

    return {
      ok: true,
      actualizadas,
    };

  } catch (e) {
    console.error('Error evaluando apuestas con FotMob:', e);
    return {
      ok: false,
      actualizadas: 0,
      error: e.message,
    };
  }
}

function construirResultadoDesdeFotmob(statsDoc) {
  const r = statsDoc.resultado_real || {};
  const s = statsDoc.stats_avanzadas || {};

  return {
    goles_local: Number(r.goles_local ?? 0),
    goles_visitante: Number(r.goles_visitante ?? 0),

    corners_totales:
      Number(s.corners_local ?? 0) + Number(s.corners_visitante ?? 0),

    corners_local: Number(s.corners_local ?? 0),
    corners_visitante: Number(s.corners_visitante ?? 0),

    amarillas_local: Number(s.amarillas_local ?? 0),
    amarillas_visitante: Number(s.amarillas_visitante ?? 0),

    rojas_local: Number(s.rojas_local ?? 0),
    rojas_visitante: Number(s.rojas_visitante ?? 0),

    xg_local: Number(s.xg_local ?? 0),
    xg_visitante: Number(s.xg_visitante ?? 0),

    tiros_local: Number(s.tiros_local ?? 0),
    tiros_visitante: Number(s.tiros_visitante ?? 0),

    tiros_puerta_local: Number(s.tiros_puerta_local ?? 0),
    tiros_puerta_visitante: Number(s.tiros_puerta_visitante ?? 0),
  };
}

function obtenerResultadoRealParaMetricas(prediccion, statsAvanzadas) {
  if (statsAvanzadas?.resultado_real) {
    return {
      fuente: 'fotmob',
      goles_local: statsAvanzadas.resultado_real.goles_local,
      goles_visitante: statsAvanzadas.resultado_real.goles_visitante,
    };
  }

  if (prediccion?.resultado_real) {
    return {
      fuente: 'manual',
      goles_local: prediccion.resultado_real.goles_local,
      goles_visitante: prediccion.resultado_real.goles_visitante,
    };
  }

  return null;
}

export async function getStatsAvanzadas(partidoId) {
  try {
    const snap = await getDoc(doc(db, 'stats_avanzadas', partidoId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (e) {
    console.error('Error leyendo stats avanzadas:', e);
    return null;
  }
}

export async function getStatsAvanzadasBatch(partidoIds) {
  const out = {};

  for (const partidoId of partidoIds) {
    out[partidoId] = await getStatsAvanzadas(partidoId);
  }

  return out;
}
export async function getTodasStatsAvanzadas() {
  try {
    const snap = await getDocs(
      query(collection(db, 'stats_avanzadas'), orderBy('actualizado_en', 'desc'))
    );

    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.error('Error leyendo todas las stats avanzadas:', e);
    return [];
  }
}