# Predictor Mundial 2026

Aplicación web para predecir partidos del Mundial FIFA 2026 usando estadística real + modelo psicológico cuantificado.

## Stack

- **Frontend**: HTML + CSS + JS vanilla (sin frameworks)
- **Hosting**: GitHub Pages (gratis)
- **Base de datos**: Firebase Firestore
- **Datos estadísticos**: football-data.org API
- **Análisis IA**: Claude API (Anthropic) con web search

## Instalación en GitHub Pages

### 1. Subir a GitHub

```bash
git init
git add .
git commit -m "Predictor Mundial 2026 v1.0"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/predictor-mundial-2026.git
git push -u origin main
```

### 2. Activar GitHub Pages

1. Ir a Settings del repositorio
2. Pages → Source: "Deploy from a branch"
3. Branch: main → / (root)
4. Save

Tu app estará en: `https://TU_USUARIO.github.io/predictor-mundial-2026`

## Uso

### Analizar un partido
1. Ir a "Analizar partido"
2. Seleccionar el partido deseado
3. El sistema automáticamente:
   - Carga estadísticas de football-data.org
   - Analiza variables psicológicas con Claude AI + web search
   - Calcula scores y genera apuestas recomendadas
4. Guardar predicción antes del partido

### Ingresar resultado real
1. Ir a "Historial"
2. Partido finalizado → "Ingresar resultado"
3. Completar goles, corners, tarjetas amarillas, xG real

### Calibrar el modelo
1. Ir a "Calibrador"
2. Con 20+ partidos: el sistema sugiere ajustes automáticos
3. Ajustar sliders o aplicar sugerencias
4. Guardar nueva versión del modelo

## Modelo de predicción

```
score_total = (score_estadístico × 60% + score_psicológico × 40%) × boost_mundialista
```

### Score estadístico (60%)
- xG promedio últimos partidos (25%)
- Forma reciente (20%)
- H2H histórico (10%)
- Corners promedio (15%)
- Goles concedidos (15%)
- Impacto de lesiones (15%)

### Score psicológico (40%)
- Presión situacional (14%)
- Factor local/ambiente (10%)
- Liderazgo y cohesión (10%)
- Momentum emocional (6%)

### Boost mundialista
- J1: boost = 1.0 + (0.10 × (1 − expectativa))
- J2: boost = 1.0 + (0.05 × (1 − expectativa))
- J3: boost = 1.0

## API Keys configuradas

Las keys están en `js/config.js`. Para rotar:
1. football-data.org: football-data.org/client → regenerar token
2. Claude API: console.anthropic.com → Claves de API → nueva clave
3. Firebase: No necesita rotación (está vinculada al proyecto)

## Estructura de archivos

```
predictor-mundial-2026/
├── index.html          Dashboard
├── analisis.html       Análisis de partido
├── historial.html      Historial y backtest
├── calibrador.html     Calibrador de pesos
├── css/
│   └── styles.css      Estilos dark mode
├── js/
│   ├── config.js       API keys y constantes
│   ├── firebase-init.js Inicialización Firebase
│   ├── firebase-db.js  Operaciones de base de datos
│   ├── api.js          football-data.org + Claude API
│   ├── modelo.js       Fórmula del modelo completa
│   ├── dashboard.js    Lógica del dashboard
│   ├── analisis.js     Lógica del análisis
│   ├── historial.js    Lógica del historial
│   └── calibrador.js   Lógica del calibrador
└── README.md
```

## Notas importantes

- Las API keys están en el frontend (visible en código fuente). Para uso con usuarios de confianza está bien. Para uso público masivo, mover las keys a un backend.
- football-data.org tier gratuito: 10 llamadas/minuto. Suficiente para uso normal.
- Claude API: ~$0.01 por análisis completo. Con 64 partidos del Mundial: < $1 total.
- Firebase Firestore tier gratuito: 50k lecturas/día. Más que suficiente.
