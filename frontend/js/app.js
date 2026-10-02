/**
 * SkyGuard AI - Main Application Controller (Upgraded)
 * Handles WebSocket telemetry streaming, multi-view navigation tabs,
 * batch CSV ingestion & self-healing, field dispatch hub, and latency SLA profiling.
 */

// Application State
const state = {
  stations: [],
  selectedStationId: null,
  evaluations: {},
  latestReadings: {},
  history: [],
  isPlaying: false,
  playTimer: null,
  ws: null,
  simulatedTime: null,
  currentView: 'live',
  isStandalone: false
};

// UI Components
let skyMap = null;
let skyCharts = null;

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
});

async function initDashboard() {
  // 1. Initialize Map
  skyMap = new SkyGuardMap('aws-map', (stationId) => {
    selectStation(stationId);
  });

  // 2. Initialize Charts
  skyCharts = new SkyGuardCharts('telemetryChart');

  // 3. Setup Navigation Tabs & View Switching
  setupViewTabs();

  // 4. Setup Chart Filters
  setupChartTabs();

  // 5. Setup Control Event Handlers
  setupControls();

  // 6. Setup Upgraded Modules (Batch CSV, Dispatch, Benchmarks)
  setupBatchCSVModule();
  setupDispatchModule();
  setupBenchmarkModule();

  // 7. Connect WebSocket & Load Initial Data
  connectWebSocket();
  await loadInitialSnapshot();
}

/**
 * Setup Navigation View Switcher (Tabs)
 */
function setupViewTabs() {
  const tabs = document.querySelectorAll('.nav-tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      const targetView = tab.getAttribute('data-view');
      switchView(targetView);
    });
  });
}

function switchView(viewName) {
  state.currentView = viewName;
  
  // Update tab buttons
  document.querySelectorAll('.nav-tab-btn').forEach(t => {
    t.classList.toggle('active', t.getAttribute('data-view') === viewName);
  });

  // Update view containers
  document.querySelectorAll('.app-view').forEach(v => {
    v.style.display = 'none';
  });

  const activeViewEl = document.getElementById(`view-${viewName}`);
  if (activeViewEl) {
    activeViewEl.style.display = 'block';
  }

  // Trigger view-specific loads
  if (viewName === 'dispatch') {
    fetchDispatchTickets();
  } else if (viewName === 'benchmarks') {
    runLatencyBenchmark();
  } else if (viewName === 'live') {
    // Invalidate map size so Leaflet resizes smoothly if tab was hidden
    setTimeout(() => {
      if (skyMap && skyMap.map) skyMap.map.invalidateSize();
    }, 150);
  }
}

/**
 * WebSocket Connection with auto-reconnect and standalone fallback
 */
function connectWebSocket() {
  const isDemoHost = window.location.hostname.includes('github.io') || window.location.protocol === 'file:';
  const statusPill = document.getElementById('stream-status-pill');
  const statusLabel = document.getElementById('stream-label');
  const liveIndicator = document.getElementById('live-indicator');

  if (isDemoHost) {
    state.isStandalone = true;
    if (statusLabel) statusLabel.textContent = 'STREAM: DEMO (STANDALONE)';
    if (statusPill) {
      statusPill.style.borderColor = 'rgba(16, 185, 129, 0.5)';
      statusPill.title = 'Running interactive client-side demo mode for GitHub Pages';
    }
    if (liveIndicator) liveIndicator.style.backgroundColor = '#10b981';
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/telemetry`;

  try {
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      statusLabel.textContent = 'STREAM: LIVE WS';
      statusPill.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      liveIndicator.style.backgroundColor = '#10b981';
    };

    state.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleStreamPayload(data);
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    state.ws.onclose = () => {
      if (state.isStandalone) return;
      statusLabel.textContent = 'STREAM: RECONNECTING';
      statusPill.style.borderColor = 'rgba(245, 158, 11, 0.4)';
      liveIndicator.style.backgroundColor = '#f59e0b';
      setTimeout(connectWebSocket, 2500);
    };

    state.ws.onerror = (err) => {
      console.warn('WS error, fallback to REST polling or standalone:', err);
    };
  } catch (err) {
    console.error('WebSocket initialization failed:', err);
  }
}

/**
 * Loads baseline stations and initial evaluation
 */
async function loadInitialSnapshot() {
  const isDemoHost = window.location.hostname.includes('github.io') || window.location.protocol === 'file:';
  if (isDemoHost || state.isStandalone) {
    activateStandaloneMode();
    return;
  }

  try {
    const res = await fetch('/api/stations');
    if (!res.ok) throw new Error('API returned status ' + res.status);
    const data = await res.json();
    
    state.stations = data.stations || [];
    state.simulatedTime = data.simulated_time;

    data.stations.forEach(s => {
      state.latestReadings[s.station_id] = s.reading;
      state.evaluations[s.station_id] = {
        verdict: s.verdict,
        verdict_reason: s.verdict_reason,
        health: s.health,
        root_cause: s.root_cause
      };
    });

    if (state.stations.length > 0 && !state.selectedStationId) {
      state.selectedStationId = state.stations[0].station_id;
    }

    renderStationList();
    skyMap.renderStations(state.stations, state.evaluations);
    updateMetricsBar();
    updateClockDisplay();
    await fetchStationDetails(state.selectedStationId);
    fetchMaintenanceQueue();
  } catch (err) {
    console.warn('Backend unavailable, activating standalone demo mode:', err);
    activateStandaloneMode();
  }
}

/**
 * Activates interactive client-side standalone simulation mode
 */
function activateStandaloneMode() {
  state.isStandalone = true;
  const statusPill = document.getElementById('stream-status-pill');
  const statusLabel = document.getElementById('stream-label');
  const liveIndicator = document.getElementById('live-indicator');
  if (statusLabel) statusLabel.textContent = 'STREAM: DEMO (STANDALONE)';
  if (statusPill) {
    statusPill.style.borderColor = 'rgba(16, 185, 129, 0.5)';
    statusPill.title = 'Running interactive client-side demo mode for GitHub Pages';
  }
  if (liveIndicator) liveIndicator.style.backgroundColor = '#10b981';

  if (typeof StandaloneDemoEngine !== 'undefined') {
    state.stations = StandaloneDemoEngine.stations;
    state.simulatedTime = StandaloneDemoEngine.getCurrentTime();
    state.latestReadings = StandaloneDemoEngine.getLatestReadings();
    state.evaluations = StandaloneDemoEngine.getLatestEvaluations();
  }

  if (state.stations.length > 0 && !state.selectedStationId) {
    state.selectedStationId = state.stations[0].station_id;
  }

  renderStationList();
  if (skyMap) skyMap.renderStations(state.stations, state.evaluations);
  updateMetricsBar();
  updateClockDisplay();
  fetchStationDetails(state.selectedStationId);
  fetchMaintenanceQueue();
}

/**
 * Handles incoming live tick payloads
 */
function handleStreamPayload(data) {
  if (data.type === 'INITIAL_SNAPSHOT' || data.type === 'TICK') {
    state.simulatedTime = data.simulated_time;
    if (data.stations) state.stations = data.stations;
    if (data.latest_readings) state.latestReadings = data.latest_readings;
    if (data.evaluations) state.evaluations = data.evaluations;

    updateClockDisplay();
    updateMetricsBar();
    renderStationList();
    if (skyMap) skyMap.renderStations(state.stations, state.evaluations);

    if (state.selectedStationId && state.currentView === 'live') {
      fetchStationDetails(state.selectedStationId, false);
    }
    fetchMaintenanceQueue();
  }
}

/**
 * Selects a station and refreshes dashboard
 */
async function selectStation(stationId) {
  state.selectedStationId = stationId;
  const evalData = state.evaluations[stationId] || {};
  const neighbors = evalData.layers?.l4_spatial?.neighbors || [];
  if (skyMap) skyMap.highlightStation(stationId, neighbors);
  renderStationList();
  await fetchStationDetails(stationId);
}

/**
 * Fetches detailed evaluations and time-series for selected station
 */
async function fetchStationDetails(stationId, updateHistory = true) {
  if (state.isStandalone && typeof StandaloneDemoEngine !== 'undefined') {
    const station = state.stations.find(s => s.station_id === stationId);
    if (!station) return;
    const evaluation = state.evaluations[stationId] || {};
    const history = StandaloneDemoEngine.getHistory(stationId);
    renderStationDetailsUI(station, evaluation, history);
    return;
  }

  try {
    const res = await fetch(`/api/stations/${stationId}`);
    if (!res.ok) {
      if (typeof StandaloneDemoEngine !== 'undefined') {
        const station = state.stations.find(s => s.station_id === stationId);
        if (station) {
          const evaluation = state.evaluations[stationId] || {};
          const history = StandaloneDemoEngine.getHistory(stationId);
          renderStationDetailsUI(station, evaluation, history);
        }
      }
      return;
    }
    const data = await res.json();
    renderStationDetailsUI(data.station, data.evaluation || {}, data.history || []);
  } catch (err) {
    if (typeof StandaloneDemoEngine !== 'undefined') {
      const station = state.stations.find(s => s.station_id === stationId);
      if (station) {
        const evaluation = state.evaluations[stationId] || {};
        const history = StandaloneDemoEngine.getHistory(stationId);
        renderStationDetailsUI(station, evaluation, history);
      }
    }
  }
}

/**
 * Renders Station details to UI cards
 */
function renderStationDetailsUI(station, evaluation, history) {
  if (!station) return;
  state.history = history;

  // 1. Update Hero Card
  document.getElementById('hero-code').textContent = station.code;
  document.getElementById('hero-name').textContent = station.name;
  document.getElementById('hero-coords').textContent = 
    `Lat: ${station.latitude}°N | Lon: ${station.longitude}°E | Elev: ${station.elevation_m}m | Dist: ${station.district}`;

  const verdictBadge = document.getElementById('hero-verdict-badge');
  const verdict = evaluation.verdict || 'NORMAL';
  verdictBadge.textContent = verdict.replace('_', ' ');
  verdictBadge.className = `hero-verdict-badge verdict-${verdict.toLowerCase().replace('_', '-')}`;
  document.getElementById('hero-verdict-reason').textContent = evaluation.verdict_reason || 'Nominal status.';

  // Health Score
  const health = evaluation.health || { health_score: 100 };
  document.getElementById('hero-health-score').textContent = `${health.health_score}%`;
  document.getElementById('hero-health-fill').style.width = `${health.health_score}%`;

  // 2. Update Sensor Pills & Self-Healing Imputation
  const cur = evaluation.reading || state.latestReadings[station.station_id] || {};
  const imp = evaluation.imputation || {};
  const healedData = imp.reading || {};
  const healedParams = imp.healed_params || [];

  // Temp
  const tempVal = cur.temperature !== null && cur.temperature !== undefined ? cur.temperature : '--';
  document.getElementById('pill-temp').textContent = tempVal;
  const badgeTemp = document.getElementById('healed-badge-temp');
  if (healedParams.includes('temperature') && healedData.temperature !== undefined) {
    badgeTemp.style.display = 'inline-block';
    badgeTemp.title = `Raw corrupted. Self-healed via Spatial IDW to ${healedData.temperature}°C`;
    document.getElementById('pill-temp-sub').textContent = `Healed Value: ${healedData.temperature}°C`;
  } else {
    badgeTemp.style.display = 'none';
    document.getElementById('pill-temp-sub').textContent = 'Diurnal Cycle: Nominal';
  }

  // Pres
  const presVal = cur.pressure !== null && cur.pressure !== undefined ? cur.pressure : '--';
  document.getElementById('pill-pressure').textContent = presVal;
  const badgePres = document.getElementById('healed-badge-pres');
  if (healedParams.includes('pressure') && healedData.pressure !== undefined) {
    badgePres.style.display = 'inline-block';
    badgePres.title = `Raw corrupted. Self-healed via MSLP IDW to ${healedData.pressure} hPa`;
    document.getElementById('pill-pressure-sub').textContent = `Healed Value: ${healedData.pressure} hPa`;
  } else {
    badgePres.style.display = 'none';
    document.getElementById('pill-pressure-sub').textContent = 'Semi-diurnal Tide: Stable';
  }

  // RH
  const rhVal = cur.humidity !== null && cur.humidity !== undefined ? cur.humidity : '--';
  document.getElementById('pill-humidity').textContent = rhVal;
  const badgeRh = document.getElementById('healed-badge-rh');
  if (healedParams.includes('humidity') && healedData.humidity !== undefined) {
    badgeRh.style.display = 'inline-block';
    badgeRh.title = `Raw unphysical. Self-healed to ${healedData.humidity}%`;
  } else {
    badgeRh.style.display = 'none';
  }

  const td = cur.dew_point !== undefined ? cur.dew_point : '--';
  document.getElementById('pill-humidity-sub').textContent = `Magnus Td: ${td}°C`;

  // 3. Update 4-Layer Inspection Cards
  updateLayerCards(evaluation.layers, cur);

  // 4. Update Diagnostics & Explainability
  updateExplainability(evaluation);

  // 5. Update Chart
  if (skyCharts) skyCharts.updateData(history);
}

/**
 * Updates the 4 QC Layer Breakdown Cards
 */
function updateLayerCards(layers, reading) {
  if (!layers) return;

  // Layer 1: Rules
  const l1 = layers.l1_rules || { passed: true };
  const l1Badge = document.getElementById('l1-badge');
  l1Badge.textContent = l1.passed ? 'PASSED' : 'VIOLATION';
  l1Badge.className = `layer-badge ${l1.passed ? 'badge-pass' : 'badge-fail'}`;
  document.getElementById('l1-footer').textContent = l1.details || '';

  // Layer 2: Temporal ML & LSTM Autoencoder
  const l2 = layers.l2_temporal || { passed: true, anomaly_score: 0.1 };
  const lstm = l2.lstm_autoencoder || { reconstruction_loss: 0.082, threshold: 0.45 };
  const l2Badge = document.getElementById('l2-badge');
  const l2Passed = l2.passed && (lstm.passed !== false);
  l2Badge.textContent = l2Passed ? 'PASSED' : 'ANOMALY';
  l2Badge.className = `layer-badge ${l2Passed ? 'badge-pass' : 'badge-fail'}`;
  document.getElementById('l2-score').textContent = `${l2.anomaly_score || 0.1} / 1.0`;
  document.getElementById('l2-lstm-loss').textContent = `${lstm.reconstruction_loss || 0.08} (Threshold: ${lstm.threshold || 0.45})`;
  document.getElementById('l2-score-bar').style.width = `${Math.min(100, (l2.anomaly_score || 0.1) * 100)}%`;
  
  const contribs = l2.contributions || {};
  const maxDriver = Object.keys(contribs).length > 0 
    ? Object.keys(contribs).reduce((a, b) => contribs[a] > contribs[b] ? a : b)
    : 'Nominal';
  document.getElementById('l2-primary-driver').textContent = maxDriver.toUpperCase();
  document.getElementById('l2-footer').textContent = l2.details || '';

  // Layer 3: Multivariate Physics
  const l3 = layers.l3_physics || { passed: true };
  const l3Badge = document.getElementById('l3-badge');
  l3Badge.textContent = l3.passed ? 'PASSED' : 'UNPHYSICAL';
  l3Badge.className = `layer-badge ${l3.passed ? 'badge-pass' : 'badge-fail'}`;
  document.getElementById('l3-dew-point').textContent = `${l3.dew_point || '--'}°C`;
  document.getElementById('l3-depression').textContent = `${l3.dew_point_depression || '--'}°C`;
  document.getElementById('l3-invariant-status').textContent = l3.passed ? 'Valid (Td ≤ T)' : 'Violation (Td > T)';
  document.getElementById('l3-invariant-status').className = `metric-val ${l3.passed ? 'text-success' : 'text-danger'}`;
  document.getElementById('l3-footer').textContent = l3.details || '';

  // Layer 4: Spatial Buddy Check
  const l4 = layers.l4_spatial || { passed: true };
  const l4Badge = document.getElementById('l4-badge');
  if (l4.is_weather_event) {
    l4Badge.textContent = 'WEATHER EVENT';
    l4Badge.className = 'layer-badge badge-alert';
  } else if (!l4.passed) {
    l4Badge.textContent = 'DISCORDANT';
    l4Badge.className = 'layer-badge badge-fail';
  } else {
    l4Badge.textContent = 'CONSENSUS';
    l4Badge.className = 'layer-badge badge-pass';
  }

  document.getElementById('l4-neighbors-count').textContent = `${l4.neighbor_count || 0} nodes (≤120km)`;
  const z = l4.spatial_z_scores || {};
  document.getElementById('l4-zscores').textContent = `T:${z.temperature ?? 0} P:${z.pressure ?? 0} RH:${z.humidity ?? 0}`;
  document.getElementById('l4-event-flag').textContent = l4.is_weather_event ? (l4.weather_event_type || 'Active Event') : 'None (Calm)';
  document.getElementById('l4-event-flag').className = `metric-val ${l4.is_weather_event ? 'text-warning' : 'text-success'}`;
  document.getElementById('l4-footer').textContent = l4.details || '';
}

/**
 * Updates Explainability & Diagnostic Attribution Section
 */
function updateExplainability(evalData) {
  const rootCause = evalData.root_cause || {};
  const attr = evalData.attribution || { temperature: 33, pressure: 33, humidity: 34 };

  let icon = '🛡️';
  if (rootCause.category === 'ATMOSPHERIC_EXTREME') icon = '🌪️';
  else if (rootCause.category === 'HARDWARE_RULE_FAILURE') icon = '🚨';
  else if (rootCause.category === 'THERMODYNAMIC_PHYSICS_FAILURE') icon = '⚡';
  else if (rootCause.category === 'LOCAL_SENSOR_ANOMALY') icon = '⚠️';

  document.getElementById('diag-icon').textContent = icon;
  document.getElementById('diag-title').textContent = rootCause.summary || 'Nominal Status';
  document.getElementById('diag-detail').textContent = rootCause.detail || 'Data satisfies all consistency checks.';
  document.getElementById('diag-action').textContent = rootCause.action || 'No maintenance required.';

  const tVal = attr.temperature || 0;
  const pVal = attr.pressure || 0;
  const rhVal = attr.humidity || 0;

  document.getElementById('attr-temp-val').textContent = `${tVal}%`;
  document.getElementById('attr-temp-bar').style.width = `${tVal}%`;

  document.getElementById('attr-pres-val').textContent = `${pVal}%`;
  document.getElementById('attr-pres-bar').style.width = `${pVal}%`;

  document.getElementById('attr-rh-val').textContent = `${rhVal}%`;
  document.getElementById('attr-rh-bar').style.width = `${rhVal}%`;
}

/**
 * Updates Metric Summary Counters
 */
function updateMetricsBar() {
  const evals = Object.values(state.evaluations);
  const total = state.stations.length;
  const normal = evals.filter(e => e.verdict === 'NORMAL').length;
  const faults = evals.filter(e => e.verdict === 'SENSOR_FAULT').length;
  const events = evals.filter(e => e.verdict === 'WEATHER_EVENT').length;
  const uncertain = evals.filter(e => e.verdict === 'UNCERTAIN').length;

  document.getElementById('stat-total-stations').textContent = total;
  document.getElementById('stat-normal-count').textContent = normal;
  document.getElementById('stat-fault-count').textContent = faults;
  document.getElementById('stat-event-count').textContent = events;
  document.getElementById('stat-uncertain-count').textContent = uncertain;
}

/**
 * Updates Simulated Time Display
 */
function updateClockDisplay() {
  if (!state.simulatedTime) return;
  const dt = new Date(state.simulatedTime);
  const formatted = dt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }) + ' IST';
  document.getElementById('clock-display').textContent = formatted;
}

/**
 * Renders Station Directory List in Left Panel
 */
function renderStationList() {
  const container = document.getElementById('station-list-container');
  if (!container) return;

  const searchTerm = (document.getElementById('station-search')?.value || '').toLowerCase();
  container.innerHTML = '';

  state.stations.forEach(s => {
    if (searchTerm && !s.name.toLowerCase().includes(searchTerm) && !s.code.toLowerCase().includes(searchTerm)) {
      return;
    }

    const sid = s.station_id;
    const evalData = state.evaluations[sid] || {};
    const verdict = evalData.verdict || 'NORMAL';
    const isActive = sid === state.selectedStationId;

    let statusClass = 'status-normal';
    if (verdict === 'SENSOR_FAULT') statusClass = 'status-fault';
    else if (verdict === 'WEATHER_EVENT') statusClass = 'status-event';
    else if (verdict === 'UNCERTAIN') statusClass = 'status-uncertain';

    const item = document.createElement('div');
    item.className = `station-item ${isActive ? 'active' : ''}`;
    item.innerHTML = `
      <div class="station-info-left">
        <span class="station-badge-code">${s.code}</span>
        <div>
          <div class="station-name-text">${s.name}</div>
          <div class="station-dist-text">${s.district} • Elev ${s.elevation_m}m</div>
        </div>
      </div>
      <span class="station-status-pill ${statusClass}">${verdict.replace('_', ' ')}</span>
    `;

    item.addEventListener('click', () => selectStation(sid));
    container.appendChild(item);
  });
}

/**
 * Maintenance Queue
 */
function renderMaintenanceQueueUI(queue) {
  const container = document.getElementById('maintenance-list');
  const countBadge = document.getElementById('maint-count');
  if (!container || !countBadge) return;

  countBadge.textContent = `${queue.length} Stations`;

  if (queue.length === 0) {
    container.innerHTML = '<div class="empty-state">All AWS stations operating nominally. No urgent dispatch required.</div>';
    return;
  }

  container.innerHTML = '';
  queue.forEach(item => {
    let pClass = 'maint-priority-medium';
    if (item.priority === 'URGENT') pClass = 'maint-priority-urgent';
    else if (item.priority === 'HIGH') pClass = 'maint-priority-high';

    const el = document.createElement('div');
    el.className = `maint-item ${pClass}`;
    el.innerHTML = `
      <div>
        <strong style="font-size: 11px;">${item.name || item.station_name} (${item.station_id})</strong>
        <div style="font-size: 10px; color: #94a3b8;">${item.diagnosis}</div>
      </div>
      <div style="text-align: right;">
        <span style="font-family: 'JetBrains Mono'; font-weight: 700; color: #ef4444; font-size: 11px;">Health: ${item.health_score}%</span>
        <div style="font-size: 9px; font-weight: 700; color: #f59e0b;">${item.priority} PRIORITY</div>
      </div>
    `;
    container.appendChild(el);
  });
}

async function fetchMaintenanceQueue() {
  if (state.isStandalone && typeof StandaloneDemoEngine !== 'undefined') {
    const data = StandaloneDemoEngine.getDispatchTickets();
    renderMaintenanceQueueUI(data.tickets || []);
    return;
  }
  try {
    const res = await fetch('/api/maintenance/queue');
    if (!res.ok) throw new Error('Queue fetch failed');
    const data = await res.json();
    renderMaintenanceQueueUI(data.queue || []);
  } catch (err) {
    if (typeof StandaloneDemoEngine !== 'undefined') {
      const data = StandaloneDemoEngine.getDispatchTickets();
      renderMaintenanceQueueUI(data.tickets || []);
    }
  }
}

/**
 * Scenario Injections
 */
async function injectScenario(scenarioType) {
  if (state.isStandalone && typeof StandaloneDemoEngine !== 'undefined') {
    const data = StandaloneDemoEngine.inject(scenarioType, state.selectedStationId);
    handleStreamPayload(data);
    return;
  }

  try {
    const payload = {
      scenario_type: scenarioType,
      target_station_id: state.selectedStationId,
      duration_ticks: 8
    };

    const res = await fetch('/api/simulation/inject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Inject failed');
    await stepTick();
  } catch (err) {
    console.warn('Backend injection failed, using standalone engine:', err);
    if (typeof StandaloneDemoEngine !== 'undefined') {
      state.isStandalone = true;
      const data = StandaloneDemoEngine.inject(scenarioType, state.selectedStationId);
      handleStreamPayload(data);
    }
  }
}
window.injectScenario = injectScenario;

/**
 * Advances simulation step
 */
async function stepTick() {
  if (state.isStandalone && typeof StandaloneDemoEngine !== 'undefined') {
    const data = StandaloneDemoEngine.tick();
    handleStreamPayload(data);
    return;
  }

  try {
    const res = await fetch('/api/simulation/tick', { method: 'POST' });
    if (!res.ok) throw new Error('Tick failed');
    const data = await res.json();
    handleStreamPayload(data);
  } catch (err) {
    console.warn('Backend tick failed, using standalone engine:', err);
    if (typeof StandaloneDemoEngine !== 'undefined') {
      state.isStandalone = true;
      const data = StandaloneDemoEngine.tick();
      handleStreamPayload(data);
    }
  }
}

/**
 * Toggles auto-run stream
 */
function toggleAutoStream() {
  state.isPlaying = !state.isPlaying;
  const playBtn = document.getElementById('btn-toggle-play');
  const playIcon = document.getElementById('play-icon');
  const playText = document.getElementById('play-text');

  if (state.isPlaying) {
    playIcon.textContent = '⏸';
    playText.textContent = 'Pause';
    playBtn.classList.add('btn-accent');
    state.playTimer = setInterval(stepTick, 3000);
  } else {
    playIcon.textContent = '▶';
    playText.textContent = 'Auto Stream';
    playBtn.classList.remove('btn-accent');
    clearInterval(state.playTimer);
    state.playTimer = null;
  }
}

/**
 * Setup Controls
 */
function setupControls() {
  document.getElementById('btn-toggle-play').addEventListener('click', toggleAutoStream);
  document.getElementById('btn-step-tick').addEventListener('click', stepTick);

  // Radar Toggle
  document.getElementById('btn-toggle-radar').addEventListener('click', () => {
    skyMap.toggleRadar();
  });

  // Station search input
  document.getElementById('station-search').addEventListener('input', () => {
    renderStationList();
  });

  // Manual Telemetry Submission
  document.getElementById('btn-submit-manual').addEventListener('click', async () => {
    const t = parseFloat(document.getElementById('manual-temp').value);
    const p = parseFloat(document.getElementById('manual-pres').value);
    const rh = parseFloat(document.getElementById('manual-rh').value);

    if (isNaN(t) && isNaN(p) && isNaN(rh)) {
      alert('Please enter at least one valid sensor reading.');
      return;
    }

    const payload = {
      station_id: state.selectedStationId,
      temperature: isNaN(t) ? 28.0 : t,
      pressure: isNaN(p) ? 1010.0 : p,
      humidity: isNaN(rh) ? 65.0 : rh
    };

    if (state.isStandalone && typeof StandaloneDemoEngine !== 'undefined') {
      state.latestReadings[state.selectedStationId] = payload;
      stepTick();
      return;
    }

    try {
      const res = await fetch('/api/telemetry/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Manual submission failed');
      const evalRes = await res.json();
      state.evaluations[state.selectedStationId] = evalRes;
      state.latestReadings[state.selectedStationId] = payload;
      fetchStationDetails(state.selectedStationId);
      updateMetricsBar();
    } catch (err) {
      console.warn('Backend unavailable for manual submission, updating standalone:', err);
      state.latestReadings[state.selectedStationId] = payload;
      stepTick();
    }
  });

  // Audit Report Modal
  document.getElementById('btn-export-report').addEventListener('click', async () => {
    if (state.isStandalone || !window.location.host.includes(':8000')) {
      const report = {
        project: "SkyGuard AI: Real-Time Anomaly Detection & Self-Healing for AWS",
        sih_problem_statement: "PS ID 26073",
        simulated_time: state.simulatedTime,
        active_nodes_count: state.stations.length,
        summary_verdicts: {
          total: state.stations.length,
          normal: Object.values(state.evaluations).filter(e => e.verdict === 'NORMAL').length,
          sensor_faults: Object.values(state.evaluations).filter(e => e.verdict === 'SENSOR_FAULT').length,
          weather_events: Object.values(state.evaluations).filter(e => e.verdict === 'WEATHER_EVENT').length
        },
        stations_status: state.stations.map(s => ({
          station_id: s.station_id,
          name: s.name,
          reading: state.latestReadings[s.station_id],
          verdict: (state.evaluations[s.station_id] || {}).verdict,
          health_score: ((state.evaluations[s.station_id] || {}).health || {}).health_score
        })),
        wmo_compliance: "WMO-No. 488 Guide to Meteorological Instruments and Methods of Observation",
        mode: state.isStandalone ? "STANDALONE_DEMO" : "LIVE_FASTAPI_SERVER"
      };
      document.getElementById('audit-report-content').textContent = JSON.stringify(report, null, 2);
      document.getElementById('audit-modal').style.display = 'flex';
      return;
    }

    try {
      const res = await fetch('/api/export/report');
      if (!res.ok) throw new Error('Report fetch failed');
      const data = await res.json();
      document.getElementById('audit-report-content').textContent = JSON.stringify(data, null, 2);
      document.getElementById('audit-modal').style.display = 'flex';
    } catch (err) {
      console.error('Error fetching audit report:', err);
    }
  });

  document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('audit-modal').style.display = 'none';
  });
  document.getElementById('modal-close-action').addEventListener('click', () => {
    document.getElementById('audit-modal').style.display = 'none';
  });

  document.getElementById('modal-download-json').addEventListener('click', async () => {
    const content = document.getElementById('audit-report-content').textContent;
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SkyGuard_Audit_Report_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

/**
 * Setup Chart Tabs
 */
function setupChartTabs() {
  const tabs = document.querySelectorAll('.chart-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      tabs.forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      const filter = e.target.getAttribute('data-chart');
      skyCharts.setFilter(filter);
    });
  });
}

/**
 * ==========================================================================
 * UPGRADE 1: BATCH CSV INGESTION & DATA IMPUTER MODULE
 * ==========================================================================
 */
function setupBatchCSVModule() {
  const dropzone = document.getElementById('csv-dropzone');
  const fileInput = document.getElementById('csv-file-input');
  const loadSampleBtn = document.getElementById('btn-load-sample-csv');
  const downloadCleanedBtn = document.getElementById('btn-download-cleaned-csv');

  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadCSVFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadCSVFile(fileInput.files[0]);
    }
  });

  loadSampleBtn.addEventListener('click', async () => {
    try {
      let text = "";
      try {
        const res = await fetch('data/sample_imd_telemetry.csv');
        if (res.ok) text = await res.text();
      } catch (_) {}

      if (!text) {
        text = "timestamp,station_id,temperature,pressure,humidity\n2026-10-01T08:00:00,AWS-OD-001,26.5,1012.3,74.0\n2026-10-01T08:15:00,AWS-OD-001,27.1,1012.1,72.5\n2026-10-01T08:30:00,AWS-OD-001,27.8,1011.8,70.0\n2026-10-01T08:45:00,AWS-OD-001,28.4,1011.5,68.2\n2026-10-01T09:00:00,AWS-OD-001,29.1,1011.0,66.0\n2026-10-01T09:15:00,AWS-OD-001,29.7,1010.8,64.5\n2026-10-01T09:30:00,AWS-OD-001,48.2,1010.5,63.0\n2026-10-01T09:45:00,AWS-OD-001,30.8,1010.2,61.5\n2026-10-01T10:00:00,AWS-OD-001,31.2,1010.0,60.0\n2026-10-01T10:15:00,AWS-OD-001,31.5,1009.8,60.0\n2026-10-01T10:30:00,AWS-OD-001,31.5,1009.8,60.0\n2026-10-01T10:45:00,AWS-OD-001,31.5,1009.8,60.0\n2026-10-01T11:00:00,AWS-OD-001,31.5,1009.8,60.0\n2026-10-01T11:15:00,AWS-OD-001,32.4,1009.2,57.5\n2026-10-01T11:30:00,AWS-OD-001,32.8,1009.0,56.0\n2026-10-01T11:45:00,AWS-OD-001,33.1,1008.8,55.0\n2026-10-01T12:00:00,AWS-OD-001,26.0,1008.5,115.0\n2026-10-01T12:15:00,AWS-OD-001,33.8,1008.2,53.5\n2026-10-01T12:30:00,AWS-OD-001,34.0,1008.0,52.0\n2026-10-01T13:30:00,AWS-OD-001,,1007.0,49.0";
      }
      const file = new File([text], 'sample_imd_telemetry.csv', { type: 'text/csv' });
      uploadCSVFile(file);
    } catch (err) {
      console.error('Error loading sample CSV:', err);
    }
  });

  if (downloadCleanedBtn) {
    downloadCleanedBtn.addEventListener('click', (e) => {
      if (state.isStandalone || typeof StandaloneDemoEngine !== 'undefined') {
        const csvData = StandaloneDemoEngine.getLastCleanedCSV();
        if (csvData) {
          e.preventDefault();
          const blob = new Blob([csvData], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'SkyGuard_Cleaned_WMO_Dataset.csv';
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    });
  }
}

async function uploadCSVFile(file) {
  if (state.isStandalone && typeof StandaloneDemoEngine !== 'undefined') {
    const text = await file.text();
    const data = StandaloneDemoEngine.processBatchCSV(text);
    renderBatchCSVResults(data);
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/qc/upload-csv', {
      method: 'POST',
      body: formData
    });

    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    renderBatchCSVResults(data);
  } catch (err) {
    console.warn('Backend CSV processing failed, using standalone processor:', err);
    if (typeof StandaloneDemoEngine !== 'undefined') {
      const text = await file.text();
      const data = StandaloneDemoEngine.processBatchCSV(text);
      renderBatchCSVResults(data);
    }
  }
}

function renderBatchCSVResults(data) {
  document.getElementById('batch-stats-grid').style.display = 'grid';
  document.getElementById('batch-table-panel').style.display = 'block';

  document.getElementById('batch-stat-total').textContent = data.total_records;
  document.getElementById('batch-stat-clean').textContent = data.clean_records;
  document.getElementById('batch-stat-faults').textContent = data.sensor_faults;
  document.getElementById('batch-stat-weather').textContent = data.weather_events;
  document.getElementById('batch-stat-healed').textContent = data.healed_records;

  const tbody = document.getElementById('batch-table-body');
  tbody.innerHTML = '';

  (data.preview || []).forEach(row => {
    const tr = document.createElement('tr');
    
    let vClass = 'status-normal';
    if (row.verdict === 'SENSOR_FAULT') vClass = 'status-fault';
    else if (row.verdict === 'WEATHER_EVENT') vClass = 'status-event';
    else if (row.verdict === 'UNCERTAIN') vClass = 'status-uncertain';

    tr.innerHTML = `
      <td>${row.timestamp ? row.timestamp.replace('T', ' ') : '--'}</td>
      <td><strong>${row.station_id}</strong></td>
      <td>${row.raw_temperature ?? '--'}°C</td>
      <td style="color: #00f5d4; font-weight: 700;">${row.cleaned_temperature ?? '--'}°C</td>
      <td>${row.raw_pressure ?? '--'}</td>
      <td style="color: #00bbf9; font-weight: 700;">${row.cleaned_pressure ?? '--'}</td>
      <td>${row.raw_humidity ?? '--'}%</td>
      <td style="color: #a855f7; font-weight: 700;">${row.cleaned_humidity ?? '--'}%</td>
      <td><span class="station-status-pill ${vClass}">${row.verdict}</span></td>
      <td>
        <span class="wmo-flag wmo-flag-${row.wmo_qc_temp_flag}">T:${row.wmo_qc_temp_flag}</span>
        <span class="wmo-flag wmo-flag-${row.wmo_qc_pres_flag}">P:${row.wmo_qc_pres_flag}</span>
        <span class="wmo-flag wmo-flag-${row.wmo_qc_rh_flag}">RH:${row.wmo_qc_rh_flag}</span>
      </td>
      <td style="font-size: 11px; color: #94a3b8;">${row.verdict_reason || 'Verified'}</td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * ==========================================================================
 * UPGRADE 2: FIELD DISPATCH HUB MODULE
 * ==========================================================================
 */
function setupDispatchModule() {
  document.getElementById('btn-refresh-tickets').addEventListener('click', fetchDispatchTickets);
}

async function fetchDispatchTickets() {
  if (state.isStandalone && typeof StandaloneDemoEngine !== 'undefined') {
    const data = StandaloneDemoEngine.getDispatchTickets();
    renderDispatchTickets(data.tickets || []);
    return;
  }

  try {
    const res = await fetch('/api/dispatch/tickets');
    if (!res.ok) throw new Error('Dispatch failed');
    const data = await res.json();
    const tickets = data.tickets || [];
    renderDispatchTickets(tickets);
  } catch (err) {
    if (typeof StandaloneDemoEngine !== 'undefined') {
      const data = StandaloneDemoEngine.getDispatchTickets();
      renderDispatchTickets(data.tickets || []);
    }
  }
}

function renderDispatchTickets(tickets) {
  const container = document.getElementById('dispatch-tickets-container');
  if (!container) return;

  if (tickets.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #64748b;">
        <span style="font-size: 36px; display: block; margin-bottom: 8px;">🛡️</span>
        <h3>All 8 AWS Nodes Operating Flawlessly</h3>
        <p>No active maintenance tickets or urgent dispatches required.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  tickets.forEach(ticket => {
    let pClass = 'medium';
    let badgeClass = 'p-medium';
    if (ticket.priority === 'URGENT') { pClass = 'urgent'; badgeClass = 'p-urgent'; }
    else if (ticket.priority === 'HIGH') { pClass = 'high'; badgeClass = 'p-high'; }

    const partsHtml = (ticket.required_spare_parts || []).map(p => `
      <li><strong>${p.part_no}:</strong> ${p.name} (${p.category})</li>
    `).join('');

    const card = document.createElement('div');
    card.className = `dispatch-card ${pClass}`;
    card.innerHTML = `
      <div class="card-header-row">
        <span class="ticket-id-tag">${ticket.ticket_id}</span>
        <span class="dispatch-priority-badge ${badgeClass}">${ticket.priority} PRIORITY</span>
      </div>
      <div>
        <h3 style="font-family: 'Outfit'; font-size: 15px; color: #fff;">${ticket.station_name} (${ticket.station_code})</h3>
        <div style="font-size: 11px; color: #94a3b8; font-family: 'JetBrains Mono'; margin-top: 2px;">
          GPS: ${ticket.gps_coordinates} | District: ${ticket.district} | Health: <span style="color: #ef4444; font-weight: 700;">${ticket.health_score}%</span>
        </div>
      </div>
      <div style="background: rgba(239, 68, 68, 0.08); padding: 8px 10px; border-radius: 6px; border-left: 3px solid #ef4444; font-size: 11px;">
        <strong style="color: #fff;">${ticket.diagnosis}</strong>
        <p style="color: #94a3b8; margin-top: 3px;">${ticket.action_required}</p>
      </div>
      <div class="parts-box">
        <span class="parts-title">📦 Required IMD Meteorological Spare Parts:</span>
        <ul class="parts-list">${partsHtml}</ul>
      </div>
      <div class="dispatch-footer-row">
        <div class="crew-info">
          <span>🚐 Assigned: <strong>${ticket.dispatch_team}</strong></span><br/>
          <span>ETA: <strong>${ticket.estimated_eta_hrs} hrs</strong> (${ticket.travel_distance_km} km)</span>
        </div>
        <button class="btn btn-primary btn-sm" onclick="alert('Technician WhatsApp Alert Sent: Ticket ${ticket.ticket_id} dispatched to ${ticket.dispatch_team} with ETA ${ticket.estimated_eta_hrs} hrs.')">
          📲 Notify Crew
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

/**
 * ==========================================================================
 * UPGRADE 3: MODEL BENCHMARKS & LATENCY SLA MODULE
 * ==========================================================================
 */
function setupBenchmarkModule() {
  document.getElementById('btn-run-benchmark').addEventListener('click', runLatencyBenchmark);
}

async function runLatencyBenchmark() {
  const btn = document.getElementById('btn-run-benchmark');
  btn.disabled = true;
  btn.textContent = '⏳ Profiling 40 Real-Time Inference Cycles...';

  if (state.isStandalone && typeof StandaloneDemoEngine !== 'undefined') {
    setTimeout(() => {
      const data = StandaloneDemoEngine.runBenchmark();
      document.getElementById('bench-mean').textContent = `${data.mean_ms} ms`;
      document.getElementById('bench-p50').textContent = `${data.median_p50_ms} ms`;
      document.getElementById('bench-p95').textContent = `${data.p95_ms} ms`;
      document.getElementById('bench-throughput').textContent = `${data.throughput_rps}`;
      btn.disabled = false;
      btn.textContent = '⚡ Re-Run Latency Test (40 Iterations)';
    }, 150);
    return;
  }

  try {
    const res = await fetch('/api/benchmark/live');
    if (!res.ok) throw new Error('Benchmark failed');
    const data = await res.json();

    document.getElementById('bench-mean').textContent = `${data.mean_ms} ms`;
    document.getElementById('bench-p50').textContent = `${data.median_p50_ms} ms`;
    document.getElementById('bench-p95').textContent = `${data.p95_ms} ms`;
    document.getElementById('bench-throughput').textContent = `${data.throughput_rps}`;

    btn.disabled = false;
    btn.textContent = '⚡ Re-Run Latency Test (40 Iterations)';
  } catch (err) {
    if (typeof StandaloneDemoEngine !== 'undefined') {
      const data = StandaloneDemoEngine.runBenchmark();
      document.getElementById('bench-mean').textContent = `${data.mean_ms} ms`;
      document.getElementById('bench-p50').textContent = `${data.median_p50_ms} ms`;
      document.getElementById('bench-p95').textContent = `${data.p95_ms} ms`;
      document.getElementById('bench-throughput').textContent = `${data.throughput_rps}`;
    }
    btn.disabled = false;
    btn.textContent = '⚡ Re-Run Latency Test (40 Iterations)';
  }
}
