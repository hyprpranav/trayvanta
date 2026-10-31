/**
 * TRAYVANTA - Intelligent Refrigerator Tray Monitoring System
 * Tagline: "Smart Monitoring. Better Food Preservation."
 *
 * Frontend Logic: Web Serial API, Real-Time Sensor Processing,
 * Alert Logic, Dynamic Live Serial Console, and Threshold Management.
 */

// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
const DEFAULT_THRESHOLDS = {
  tempWarning: 5.0,    // °C - Above this is Warning
  tempCritical: 8.0,   // °C - Above this is Critical
  mq135Warning: 1600,  // Raw ADC - Above this is Warning
  mq135Critical: 2200  // Raw ADC - Above this triggers "Possible Food Spoilage / Gas Anomaly"
};

let thresholds = { ...DEFAULT_THRESHOLDS };

// Web Serial Connection State
let port = null;
let reader = null;
let readableStreamClosed = null;
let keepReading = false;
let packetCount = 0;

// Alert Persistence Counters (to avoid noise-triggered false alarms)
let consecutiveGasCritical = 0;
let consecutiveTempCritical = 0;
const PERSISTENCE_THRESHOLD = 2; // Requires 2 consecutive readings to trigger emergency alert

let lastEmergencyTimestamp = null;
let currentEmergencyState = 'NORMAL'; // 'NORMAL' | 'WARNING' | 'CRITICAL'

// ==========================================
// 2. DOM ELEMENT REFERENCES
// ==========================================
const el = {
  // Banners & Header
  browserWarningBanner: document.getElementById('browser-warning-banner'),
  statusPill: document.getElementById('connection-status-pill'),
  statusDot: document.getElementById('status-dot'),
  statusLabel: document.getElementById('status-label'),
  btnConnect: document.getElementById('btn-connect'),
  btnConnectLabel: document.getElementById('btn-connect-label'),
  btnDisconnect: document.getElementById('btn-disconnect'),
  btnSettings: document.getElementById('btn-settings'),

  // Sensor Card 1 (Environment - DHT22)
  valEnvTemp: document.getElementById('val-env-temp'),
  valEnvHum: document.getElementById('val-env-hum'),
  envStatusBadge: document.getElementById('env-status-badge'),
  envFooterNote: document.getElementById('env-footer-note'),

  // Sensor Card 2 (Tray Temperature - DS18B20)
  valTrayTemp: document.getElementById('val-tray-temp'),
  trayTempStatusBadge: document.getElementById('tray-temp-status-badge'),
  trayTempFooterNote: document.getElementById('tray-temp-footer-note'),

  // Sensor Card 3 (Gas Quality - MQ135)
  valMq135Raw: document.getElementById('val-mq135-raw'),
  valMq135Voltage: document.getElementById('val-mq135-voltage'),
  gasStatusBadge: document.getElementById('gas-status-badge'),
  gasFooterNote: document.getElementById('gas-footer-note'),

  // Sensor Card 4 (Tray Weight - 5KG Load Cell + HX711)
  valTrayWeight: document.getElementById('val-tray-weight'),
  weightStatusBadge: document.getElementById('weight-status-badge'),
  weightFooterNote: document.getElementById('weight-footer-note'),

  // Emergency Alert Section
  alertPanel: document.getElementById('alert-panel'),
  alertIconNormal: document.getElementById('alert-icon-normal'),
  alertIconEmergency: document.getElementById('alert-icon-emergency'),
  alertTitle: document.getElementById('alert-title'),
  alertLevelBadge: document.getElementById('alert-level-badge'),
  alertDescription: document.getElementById('alert-description'),
  alertParameterDetail: document.getElementById('alert-parameter-detail'),
  alertTimestamp: document.getElementById('alert-timestamp'),

  // Live Serial Monitor
  serialTerminal: document.getElementById('serial-terminal'),
  consoleLed: document.getElementById('console-led'),
  packetCounter: document.getElementById('packet-counter'),
  chkAutoscroll: document.getElementById('chk-autoscroll'),
  btnClearConsole: document.getElementById('btn-clear-console'),

  // Settings Modal
  settingsModal: document.getElementById('settings-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  settingsForm: document.getElementById('settings-form'),
  inputTempWarning: document.getElementById('input-temp-warning'),
  inputTempCritical: document.getElementById('input-temp-critical'),
  inputMq135Warning: document.getElementById('input-mq135-warning'),
  inputMq135Critical: document.getElementById('input-mq135-critical'),
  btnResetThresholds: document.getElementById('btn-reset-thresholds')
};

// ==========================================
// 3. INITIALIZATION & STORAGE
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  loadSavedThresholds();
  updateThresholdHints();
  checkWebSerialSupport();
  setupEventListeners();
  resetDashboardReadings();
});

function loadSavedThresholds() {
  try {
    const saved = localStorage.getItem('trayvanta_thresholds');
    if (saved) {
      thresholds = { ...DEFAULT_THRESHOLDS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Could not load thresholds from localStorage:', e);
  }
}

function saveThresholds() {
  try {
    localStorage.setItem('trayvanta_thresholds', JSON.stringify(thresholds));
  } catch (e) {
    console.warn('Could not save thresholds to localStorage:', e);
  }
  updateThresholdHints();
}

function updateThresholdHints() {
  el.trayTempFooterNote.textContent = `Thresholds: < ${thresholds.tempWarning.toFixed(1)}°C Normal | > ${thresholds.tempCritical.toFixed(1)}°C Critical`;
  el.gasFooterNote.textContent = `Warning: > ${thresholds.mq135Warning} ADC | Critical: > ${thresholds.mq135Critical} ADC`;
}

// ==========================================
// 4. WEB SERIAL API HANDLING
// ==========================================
function checkWebSerialSupport() {
  if (!('serial' in navigator)) {
    el.browserWarningBanner.classList.remove('hidden');
    el.btnConnect.disabled = true;
    el.btnConnect.title = 'Web Serial API is not supported in this browser.';
    logTerminal('SYSTEM', 'WARNING: Web Serial API not supported. Please use Google Chrome or Microsoft Edge on a desktop.', 'terminal-warning');
    return false;
  }
  return true;
}

function setupEventListeners() {
  el.btnConnect.addEventListener('click', handleConnectESP32);
  el.btnDisconnect.addEventListener('click', handleDisconnectESP32);
  el.btnClearConsole.addEventListener('click', () => {
    el.serialTerminal.innerHTML = '';
    logTerminal('SYSTEM', 'Console cleared.', 'terminal-system');
  });

  // Settings Modal Handlers
  el.btnSettings.addEventListener('click', openSettingsModal);
  el.btnCloseModal.addEventListener('click', closeSettingsModal);
  el.settingsModal.addEventListener('click', (e) => {
    if (e.target === el.settingsModal) closeSettingsModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.settingsModal.classList.contains('hidden')) {
      closeSettingsModal();
    }
  });

  el.settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    thresholds.tempWarning = parseFloat(el.inputTempWarning.value) || DEFAULT_THRESHOLDS.tempWarning;
    thresholds.tempCritical = parseFloat(el.inputTempCritical.value) || DEFAULT_THRESHOLDS.tempCritical;
    thresholds.mq135Warning = parseInt(el.inputMq135Warning.value, 10) || DEFAULT_THRESHOLDS.mq135Warning;
    thresholds.mq135Critical = parseInt(el.inputMq135Critical.value, 10) || DEFAULT_THRESHOLDS.mq135Critical;
    saveThresholds();
    closeSettingsModal();
    logTerminal('SYSTEM', 'Alert thresholds updated and saved to local storage.', 'terminal-system');
  });

  el.btnResetThresholds.addEventListener('click', () => {
    thresholds = { ...DEFAULT_THRESHOLDS };
    el.inputTempWarning.value = thresholds.tempWarning;
    el.inputTempCritical.value = thresholds.tempCritical;
    el.inputMq135Warning.value = thresholds.mq135Warning;
    el.inputMq135Critical.value = thresholds.mq135Critical;
    saveThresholds();
    closeSettingsModal();
    logTerminal('SYSTEM', 'Alert thresholds reset to factory defaults.', 'terminal-system');
  });

  // Native USB Cable Removal Detection
  navigator.serial.addEventListener('disconnect', (event) => {
    if (port && event.target === port) {
      logTerminal('SYSTEM', 'ESP32 disconnected: USB cable was physically unplugged.', 'terminal-error');
      handleDisconnectESP32();
    }
  });
}

function openSettingsModal() {
  el.inputTempWarning.value = thresholds.tempWarning;
  el.inputTempCritical.value = thresholds.tempCritical;
  el.inputMq135Warning.value = thresholds.mq135Warning;
  el.inputMq135Critical.value = thresholds.mq135Critical;
  el.settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  el.settingsModal.classList.add('hidden');
}

// ==========================================
// 5. CONNECTION FLOW
// ==========================================
async function handleConnectESP32() {
  if (!checkWebSerialSupport()) return;

  setConnectionState('CONNECTING');
  logTerminal('SYSTEM', 'Requesting serial port... Please select your ESP32 in the browser prompt.', 'terminal-system');

  try {
    // 1. Request port from native browser picker
    port = await navigator.serial.requestPort();

    // 2. Open selected port with configured baud rate
    await port.open({ baudRate: 115200 });

    setConnectionState('CONNECTED');
    logTerminal('SYSTEM', 'ESP32 Connected at 115200 baud. Receiving real-time telemetry...', 'terminal-system');

    // 3. Start reading incoming serial line stream
    keepReading = true;
    readSerialStream();

  } catch (error) {
    console.error('Serial Connection Error:', error);
    setConnectionState('DISCONNECTED');

    if (error.name === 'NotFoundError') {
      logTerminal('SYSTEM', 'Connection cancelled: No serial port selected.', 'terminal-warning');
    } else if (error.name === 'SecurityError') {
      logTerminal('SYSTEM', 'Security error: Permission to access serial port was denied.', 'terminal-error');
    } else {
      logTerminal('SYSTEM', `Connection failed: ${error.message}`, 'terminal-error');
    }
  }
}

async function handleDisconnectESP32() {
  keepReading = false;

  try {
    if (reader) {
      await reader.cancel();
      reader = null;
    }
    if (readableStreamClosed) {
      await readableStreamClosed.catch(() => {});
      readableStreamClosed = null;
    }
    if (port) {
      await port.close();
      port = null;
    }
    logTerminal('SYSTEM', 'ESP32 Disconnected by user.', 'terminal-system');
  } catch (error) {
    console.warn('Error during disconnect cleanup:', error);
  } finally {
    setConnectionState('DISCONNECTED');
    resetDashboardReadings();
  }
}

function setConnectionState(state) {
  if (state === 'CONNECTED') {
    el.statusPill.className = 'status-pill status-connected';
    el.statusLabel.textContent = 'ESP32 CONNECTED';
    el.btnConnect.classList.add('hidden');
    el.btnDisconnect.classList.remove('hidden');
    el.consoleLed.classList.add('active');
  } else if (state === 'CONNECTING') {
    el.statusPill.className = 'status-pill status-connecting';
    el.statusLabel.textContent = 'Connecting...';
    el.btnConnect.disabled = true;
    el.btnConnectLabel.textContent = 'CONNECTING...';
    el.btnDisconnect.classList.add('hidden');
    el.consoleLed.classList.remove('active');
  } else {
    el.statusPill.className = 'status-pill status-disconnected';
    el.statusLabel.textContent = 'ESP32 Disconnected';
    el.btnConnect.disabled = false;
    el.btnConnectLabel.textContent = 'CONNECT ESP32';
    el.btnConnect.classList.remove('hidden');
    el.btnDisconnect.classList.add('hidden');
    el.consoleLed.classList.remove('active');
  }
}

// ==========================================
// 6. SERIAL STREAM READER & PARSER
// ==========================================
async function readSerialStream() {
  const textDecoder = new TextDecoderStream();
  readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
  reader = textDecoder.readable.getReader();

  let lineBuffer = '';

  try {
    while (keepReading) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        lineBuffer += value;
        const lines = lineBuffer.split('\n');
        // Keep trailing incomplete fragment in the buffer
        lineBuffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            processIncomingLine(trimmed);
          }
        }
      }
    }
  } catch (error) {
    if (keepReading) {
      console.error('Serial read error:', error);
      logTerminal('SYSTEM', `Serial stream read error: ${error.message}`, 'terminal-error');
      handleDisconnectESP32();
    }
  } finally {
    if (reader) {
      reader.releaseLock();
    }
  }
}

// ==========================================
// 7. SENSOR DATA PROCESSING
// ==========================================
function processIncomingLine(line) {
  // Only parse valid JSON objects
  if (!line.startsWith('{') || !line.endsWith('}')) {
    // Non-JSON informational output from device
    logTerminal('DEVICE', line, 'terminal-system');
    return;
  }

  let data;
  try {
    data = JSON.parse(line);
  } catch (err) {
    console.warn('JSON parsing error:', err, line);
    return;
  }

  packetCount++;
  el.packetCounter.textContent = `Packets: ${packetCount}`;

  // 1. Process Environment Monitoring (DHT22)
  updateEnvironmentCard(data);

  // 2. Process Refrigerator Tray Temperature (DS18B20)
  const trayTempStatus = updateTrayTempCard(data);

  // 3. Process Gas / Air Quality Monitoring (MQ135)
  const gasStatus = updateGasCard(data);

  // 4. Process Tray Weight (5KG Load Cell + HX711)
  updateWeightCard(data);

  // 5. Update Emergency Alert State based on evaluated statuses
  evaluateEmergencyAlert(data, trayTempStatus, gasStatus);

  // 6. Append Clean Structured Information to Live Serial Console
  logFormattedSerialTelemetry(data);
}

// --- Card 1: Environment (DHT22) ---
function updateEnvironmentCard(data) {
  const tempValid = data.environment_temperature !== null && !isNaN(data.environment_temperature);
  const humValid = data.environment_humidity !== null && !isNaN(data.environment_humidity);

  if (tempValid) {
    el.valEnvTemp.textContent = Number(data.environment_temperature).toFixed(2);
  } else {
    el.valEnvTemp.textContent = '--';
  }

  if (humValid) {
    el.valEnvHum.textContent = Number(data.environment_humidity).toFixed(2);
  } else {
    el.valEnvHum.textContent = '--';
  }

  if (tempValid && humValid) {
    setCardBadge(el.envStatusBadge, 'Normal', 'status-badge-normal');
  } else {
    setCardBadge(el.envStatusBadge, 'Sensor Error', 'status-badge-error');
  }
}

// --- Card 2: Refrigerator Tray Temperature (DS18B20) ---
function updateTrayTempCard(data) {
  const tempValid = data.refrigerator_temperature !== null && !isNaN(data.refrigerator_temperature);

  if (!tempValid) {
    el.valTrayTemp.textContent = '--';
    setCardBadge(el.trayTempStatusBadge, 'Disconnected', 'status-badge-error');
    return 'ERROR';
  }

  const temp = Number(data.refrigerator_temperature);
  el.valTrayTemp.textContent = temp.toFixed(2);

  if (temp >= thresholds.tempCritical) {
    setCardBadge(el.trayTempStatusBadge, 'Critical', 'status-badge-critical');
    return 'CRITICAL';
  } else if (temp >= thresholds.tempWarning) {
    setCardBadge(el.trayTempStatusBadge, 'Warning', 'status-badge-warning');
    return 'WARNING';
  } else {
    setCardBadge(el.trayTempStatusBadge, 'Normal', 'status-badge-normal');
    return 'NORMAL';
  }
}

// --- Card 3: Gas / Air Quality (MQ135) ---
function updateGasCard(data) {
  const rawValid = data.mq135_raw !== null && !isNaN(data.mq135_raw);
  const voltValid = data.mq135_voltage !== null && !isNaN(data.mq135_voltage);

  if (!rawValid) {
    el.valMq135Raw.textContent = '--';
    el.valMq135Voltage.textContent = '--';
    setCardBadge(el.gasStatusBadge, 'Sensor Error', 'status-badge-error');
    return 'ERROR';
  }

  const raw = parseInt(data.mq135_raw, 10);
  const volt = Number(data.mq135_voltage);

  el.valMq135Raw.textContent = raw;
  el.valMq135Voltage.textContent = voltValid ? volt.toFixed(2) : '--';

  if (raw >= thresholds.mq135Critical) {
    setCardBadge(el.gasStatusBadge, 'Critical', 'status-badge-critical');
    return 'CRITICAL';
  } else if (raw >= thresholds.mq135Warning) {
    setCardBadge(el.gasStatusBadge, 'Warning', 'status-badge-warning');
    return 'WARNING';
  } else {
    setCardBadge(el.gasStatusBadge, 'Normal', 'status-badge-normal');
    return 'NORMAL';
  }
}

// --- Card 4: Tray Weight (Load Cell + HX711) ---
function updateWeightCard(data) {
  const weightValid = data.weight_kg !== null && !isNaN(data.weight_kg);

  if (weightValid) {
    const weight = Number(data.weight_kg);
    el.valTrayWeight.textContent = weight.toFixed(2);
    setCardBadge(el.weightStatusBadge, 'Connected', 'status-badge-normal');
  } else {
    el.valTrayWeight.textContent = '--';
    setCardBadge(el.weightStatusBadge, 'Sensor Error', 'status-badge-error');
  }
}

function setCardBadge(badgeElement, text, className) {
  badgeElement.className = `card-status-badge ${className}`;
  badgeElement.textContent = text;
}

// ==========================================
// 8. EMERGENCY ALERT SYSTEM
// ==========================================
function evaluateEmergencyAlert(data, trayTempStatus, gasStatus) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString();

  // Update persistence filters
  if (gasStatus === 'CRITICAL') {
    consecutiveGasCritical++;
  } else {
    consecutiveGasCritical = Math.max(0, consecutiveGasCritical - 1);
  }

  if (trayTempStatus === 'CRITICAL') {
    consecutiveTempCritical++;
  } else {
    consecutiveTempCritical = Math.max(0, consecutiveTempCritical - 1);
  }

  // Check for Critical Gas Anomaly (Highest priority: Possible food spoilage)
  if (consecutiveGasCritical >= PERSISTENCE_THRESHOLD) {
    currentEmergencyState = 'CRITICAL';
    lastEmergencyTimestamp = timeStr;

    el.alertPanel.className = 'alert-panel alert-panel-critical';
    el.alertIconNormal.classList.add('hidden');
    el.alertIconEmergency.classList.remove('hidden');

    el.alertTitle.textContent = '⚠ POSSIBLE FOOD SPOILAGE ALERT';
    el.alertLevelBadge.className = 'alert-level-badge level-critical';
    el.alertLevelBadge.textContent = 'CRITICAL ANOMALY';

    el.alertDescription.textContent =
      'Possible Food Spoilage / Gas Anomaly Detected: MQ135 sensor detected elevated air-quality variation exceeding safe critical threshold. Recommend physical tray inspection.';

    el.alertParameterDetail.textContent =
      `Parameter: MQ135 Gas | Current ADC: ${data.mq135_raw} (${Number(data.mq135_voltage || 0).toFixed(2)} V) | Critical Threshold: > ${thresholds.mq135Critical}`;
    el.alertTimestamp.textContent = `Alert Triggered: ${timeStr}`;
    return;
  }

  // Check for Critical Refrigerator Temperature
  if (consecutiveTempCritical >= PERSISTENCE_THRESHOLD) {
    currentEmergencyState = 'CRITICAL';
    lastEmergencyTimestamp = timeStr;

    el.alertPanel.className = 'alert-panel alert-panel-critical';
    el.alertIconNormal.classList.add('hidden');
    el.alertIconEmergency.classList.remove('hidden');

    el.alertTitle.textContent = '⚠ REFRIGERATOR TEMPERATURE ALERT';
    el.alertLevelBadge.className = 'alert-level-badge level-critical';
    el.alertLevelBadge.textContent = 'CRITICAL TEMP';

    el.alertDescription.textContent =
      'Refrigerator Tray Temperature Alert: Internal tray temperature exceeded preservation limit. High temperature reduces shelf life and risks spoilage.';

    el.alertParameterDetail.textContent =
      `Parameter: Tray Temperature | Current: ${Number(data.refrigerator_temperature).toFixed(2)} °C | Critical Threshold: > ${thresholds.tempCritical.toFixed(1)} °C`;
    el.alertTimestamp.textContent = `Alert Triggered: ${timeStr}`;
    return;
  }

  // Check for Warning Levels
  if (gasStatus === 'WARNING' || trayTempStatus === 'WARNING') {
    currentEmergencyState = 'WARNING';
    el.alertPanel.className = 'alert-panel alert-panel-warning';
    el.alertIconNormal.classList.add('hidden');
    el.alertIconEmergency.classList.remove('hidden');

    el.alertTitle.textContent = 'SYSTEM WARNING: ELEVATED READINGS';
    el.alertLevelBadge.className = 'alert-level-badge level-warning';
    el.alertLevelBadge.textContent = 'WARNING';

    if (gasStatus === 'WARNING') {
      el.alertDescription.textContent =
        'Notice: Gas/air-quality sensor reading is moderately elevated above normal baseline.';
      el.alertParameterDetail.textContent =
        `Parameter: MQ135 Gas | Current ADC: ${data.mq135_raw} | Warning Threshold: > ${thresholds.mq135Warning}`;
    } else {
      el.alertDescription.textContent =
        'Notice: Refrigerator tray temperature is slightly above optimal preservation target.';
      el.alertParameterDetail.textContent =
        `Parameter: Tray Temperature | Current: ${Number(data.refrigerator_temperature).toFixed(2)} °C | Warning Threshold: > ${thresholds.tempWarning.toFixed(1)} °C`;
    }

    el.alertTimestamp.textContent = `Last Checked: ${timeStr}`;
    return;
  }

  // Normal Status (Clean & Calm)
  currentEmergencyState = 'NORMAL';
  el.alertPanel.className = 'alert-panel alert-panel-normal';
  el.alertIconNormal.classList.remove('hidden');
  el.alertIconEmergency.classList.add('hidden');

  el.alertTitle.textContent = 'SYSTEM STATUS: ALL PARAMETERS NORMAL';
  el.alertLevelBadge.className = 'alert-level-badge level-normal';
  el.alertLevelBadge.textContent = 'NORMAL';

  el.alertDescription.textContent =
    'All tray parameters are within acceptable safe ranges. No gas anomalies or temperature deviations detected.';

  el.alertParameterDetail.textContent =
    'Monitored Sensors: DHT22, DS18B20, MQ135, HX711';

  if (lastEmergencyTimestamp) {
    el.alertTimestamp.textContent = `Last Anomaly Cleared (Prior Alert: ${lastEmergencyTimestamp})`;
  } else {
    el.alertTimestamp.textContent = `Last Checked: ${timeStr}`;
  }
}

// ==========================================
// 9. LIVE SERIAL MONITOR FORMATTING
// ==========================================
function logFormattedSerialTelemetry(data) {
  const time = getTimestamp();

  // Create human-readable serial logs matching section 12 requirement
  let linesHtml = '';

  if (data.environment_temperature !== null && data.environment_humidity !== null) {
    linesHtml += `<div class="terminal-line terminal-reading"><span class="t-time">[${time}]</span> <span class="t-msg"><span class="t-param">Environment Temperature:</span> <span class="t-val">${Number(data.environment_temperature).toFixed(2)} °C</span></span></div>`;
    linesHtml += `<div class="terminal-line terminal-reading"><span class="t-time">[${time}]</span> <span class="t-msg"><span class="t-param">Environment Humidity:</span> <span class="t-val">${Number(data.environment_humidity).toFixed(2)} %</span></span></div>`;
  }

  if (data.refrigerator_temperature !== null) {
    linesHtml += `<div class="terminal-line terminal-reading"><span class="t-time">[${time}]</span> <span class="t-msg"><span class="t-param">Refrigerator Temperature:</span> <span class="t-val">${Number(data.refrigerator_temperature).toFixed(2)} °C</span></span></div>`;
  } else {
    linesHtml += `<div class="terminal-line terminal-error"><span class="t-time">[${time}]</span> <span class="t-msg">Refrigerator Temp Sensor: Disconnected / Error</span></div>`;
  }

  if (data.mq135_raw !== null) {
    linesHtml += `<div class="terminal-line terminal-reading"><span class="t-time">[${time}]</span> <span class="t-msg"><span class="t-param">MQ135 Raw:</span> <span class="t-val">${data.mq135_raw}</span> | <span class="t-param">Voltage:</span> <span class="t-val">${Number(data.mq135_voltage || 0).toFixed(2)} V</span></span></div>`;
  }

  // Strictly formatted weight in KG (Never raw HX711!)
  if (data.weight_kg !== null) {
    linesHtml += `<div class="terminal-line terminal-reading"><span class="t-time">[${time}]</span> <span class="t-msg"><span class="t-param">Tray Weight:</span> <span class="t-val">${Number(data.weight_kg).toFixed(2)} KG</span></span></div>`;
  } else {
    linesHtml += `<div class="terminal-line terminal-error"><span class="t-time">[${time}]</span> <span class="t-msg">Load Cell Status: Error / Not Ready</span></div>`;
  }

  appendTerminalHtml(linesHtml);
}

function logTerminal(prefix, message, typeClass = 'terminal-system') {
  const time = getTimestamp();
  const html = `<div class="terminal-line ${typeClass}"><span class="t-time">[${time}]</span> <span class="t-msg">${message}</span></div>`;
  appendTerminalHtml(html);
}

function appendTerminalHtml(html) {
  el.serialTerminal.insertAdjacentHTML('beforeend', html);

  // Buffer management: prune older entries if terminal exceeds 150 items
  while (el.serialTerminal.children.length > 150) {
    el.serialTerminal.removeChild(el.serialTerminal.firstElementChild);
  }

  if (el.chkAutoscroll.checked) {
    el.serialTerminal.scrollTop = el.serialTerminal.scrollHeight;
  }
}

function getTimestamp() {
  const d = new Date();
  return d.toTimeString().split(' ')[0]; // "HH:MM:SS"
}

// Reset values when disconnected
function resetDashboardReadings() {
  el.valEnvTemp.textContent = '--';
  el.valEnvHum.textContent = '--';
  el.valTrayTemp.textContent = '--';
  el.valMq135Raw.textContent = '--';
  el.valMq135Voltage.textContent = '--';
  el.valTrayWeight.textContent = '--';

  setCardBadge(el.envStatusBadge, 'Disconnected', 'status-badge-error');
  setCardBadge(el.trayTempStatusBadge, 'Disconnected', 'status-badge-error');
  setCardBadge(el.gasStatusBadge, 'Disconnected', 'status-badge-error');
  setCardBadge(el.weightStatusBadge, 'Disconnected', 'status-badge-error');

  consecutiveGasCritical = 0;
  consecutiveTempCritical = 0;
  currentEmergencyState = 'NORMAL';

  el.alertPanel.className = 'alert-panel alert-panel-normal';
  el.alertIconNormal.classList.remove('hidden');
  el.alertIconEmergency.classList.add('hidden');
  el.alertTitle.textContent = 'SYSTEM STATUS: ESP32 DISCONNECTED';
  el.alertLevelBadge.className = 'alert-level-badge level-normal';
  el.alertLevelBadge.textContent = 'IDLE';
  el.alertDescription.textContent =
    'Connect ESP32 via USB and click "CONNECT ESP32" to begin live monitoring.';
  el.alertParameterDetail.textContent = 'Awaiting USB Serial Telemetry';
  el.alertTimestamp.textContent = `Status: Standby`;
}
