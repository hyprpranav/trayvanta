/**
 * TRAYVANTA - Smart Refrigeration Digital Twin & Food Inventory Management System
 * 
 * Main Frontend Controller:
 * - Web Serial API Hardware Telemetry (115200 baud, USB-CDC)
 * - Firebase Cloud Firestore Persistence & Real-Time Sync
 * - 5 Dynamic Modules (Digital Twin, Monitoring, Products, Risk Analysis, History & Export)
 * - Deterministic Rule-Based Food Risk Analysis Engine (REMOVE > SELL FIRST > INSPECT > SAFE)
 * - Periodic Cloud Snapshot Saving (10s interval & Warning state transitions)
 * - High-DPI Interactive Telemetry Canvas Chart
 * - Comprehensive Demonstration Simulation Mode
 * - RFC 4180 Compliant Sensor History CSV Exporter
 */

import {
  initFirebase,
  onFirebaseStatusChange,
  saveSensorReading,
  getHistoricalReadings,
  subscribeProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  saveAlert,
  saveAppSettings
} from './firebase.js';

// ==========================================
// 1. CONFIGURATION & STATE
// ==========================================
const DEFAULT_THRESHOLDS = {
  tempWarning: 5.0,    // °C - Above this is Warning / INSPECT
  tempCritical: 8.0,   // °C - Above this is Critical
  tempRiskRemove: 9.0, // °C - Reaching 9°C triggers REMOVE food risk
  mq135Warning: 1600,  // Raw ADC
  mq135Critical: 2200, // Raw ADC
  snapshotIntervalSec: 10,
  deviceId: 'TRAYVANTA_ESP32_01'
};

let thresholds = { ...DEFAULT_THRESHOLDS };

// Active Telemetry State
let currentTelemetry = {
  environmentTemperature: null,
  environmentHumidity: null,
  refrigeratorTemperature: null,
  mq135Raw: null,
  mq135Voltage: null,
  trayWeightKg: null,
  warningStatus: 'NORMAL',
  dataSource: 'LIVE', // 'LIVE' | 'SIMULATED'
  timestamp: null
};

// Web Serial Hardware State
let port = null;
let reader = null;
let readableStreamClosed = null;
let keepReading = false;
let packetCount = 0;
let isHardwareConnected = false;

// Alert State & Persistence
let consecutiveGasCritical = 0;
let consecutiveTempCritical = 0;
const PERSISTENCE_THRESHOLD = 2;
let lastEmergencyTimestamp = null;
let currentEmergencyState = 'NORMAL'; // 'NORMAL' | 'WARNING' | 'CRITICAL'
let previousWarningState = 'NORMAL';

// Simulation / Demo Mode State
let isDemoMode = false;
let demoTimer = null;
let demoTickCount = 0;
let demoBaseTemp = 3.6;
let demoBaseHum = 68.0;
let demoBaseGas = 1050;
let demoBaseWeight = 2.85;

// Inventory & Products State
let productsList = [];
let editingProductId = null;

// History & Snapshot State
let snapshotTimer = null;
let historyBuffer = [];
let chartHistoryPoints = []; // Recent telemetry points for chart

// Active Navigation
let activePage = 'digital-twin';

// Chart View Mode
let chartMode = 'env'; // 'env' | 'weight'
let chartRangeSeconds = 30; // 30s, 60s, 300s, 0 (all)

// ==========================================
// 2. DOM REFERENCES
// ==========================================
const dom = {
  // Navigation & Shell
  sidebar: document.getElementById('app-sidebar'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  btnSidebarToggle: document.getElementById('btn-sidebar-toggle'),
  btnSidebarClose: document.getElementById('btn-sidebar-close'),
  headerPageTitle: document.getElementById('header-page-title'),
  navItems: document.querySelectorAll('.nav-item'),
  pageSections: document.querySelectorAll('.page-section'),
  btnNavActions: document.querySelectorAll('.btn-nav-action'),

  // Header Status & Controls
  browserWarningBanner: document.getElementById('browser-warning-banner'),
  dataSourceBadge: document.getElementById('data-source-badge'),
  dataSourceLabel: document.getElementById('data-source-label'),
  connectionStatusPill: document.getElementById('connection-status-pill'),
  statusDot: document.getElementById('status-dot'),
  statusLabel: document.getElementById('status-label'),
  firebaseStatusPill: document.getElementById('firebase-status-pill'),
  firebaseStatusLabel: document.getElementById('firebase-status-label'),
  btnConnect: document.getElementById('btn-connect'),
  btnConnectLabel: document.getElementById('btn-connect-label'),
  btnDisconnect: document.getElementById('btn-disconnect'),
  btnDemoMode: document.getElementById('btn-demo-mode'),
  btnDemoLabel: document.getElementById('btn-demo-label'),
  btnSettings: document.getElementById('btn-settings'),

  // Simulation Banner
  simulationBanner: document.getElementById('simulation-banner'),
  btnSimTempRise: document.getElementById('btn-sim-temp-rise'),
  btnSimReset: document.getElementById('btn-sim-reset'),
  btnSimStop: document.getElementById('btn-sim-stop'),

  // Sidebar Mini Telemetry
  miniTrayStatus: document.getElementById('mini-tray-status'),
  miniTrayTemp: document.getElementById('mini-tray-temp'),
  miniTrayWeight: document.getElementById('mini-tray-weight'),
  trayItemCountBadge: document.getElementById('tray-item-count-badge'),
  inventoryTotalBadge: document.getElementById('inventory-total-badge'),
  navRiskSummaryPill: document.getElementById('nav-risk-summary-pill'),

  // Module 1: Digital Twin
  twinValTemp: document.getElementById('twin-val-temp'),
  twinStatusTemp: document.getElementById('twin-status-temp'),
  twinValHum: document.getElementById('twin-val-hum'),
  twinStatusHum: document.getElementById('twin-status-hum'),
  twinValWeight: document.getElementById('twin-val-weight'),
  twinStatusWeight: document.getElementById('twin-status-weight'),
  twinOverallTitle: document.getElementById('twin-overall-title'),
  twinOverallChip: document.getElementById('twin-overall-chip'),
  twinMq135Sub: document.getElementById('twin-mq135-sub'),
  twinTraySurface: document.getElementById('twin-tray-surface'),
  twinTrayGaugeFill: document.getElementById('twin-tray-gauge-fill'),
  twinTrayGaugeText: document.getElementById('twin-tray-gauge-text'),
  refrigeratorAmbientGlow: document.getElementById('refrigerator-ambient-glow'),
  acrylicTemp: document.getElementById('acrylic-temp'),
  acrylicHum: document.getElementById('acrylic-hum'),
  acrylicWeight: document.getElementById('acrylic-weight'),

  // Module 1: 3D Cold-Room Interactive Viewport & HUD Elements
  twin3dWrapper: document.getElementById('twin-3d-wrapper'),
  twin2dWrapper: document.getElementById('twin-2d-wrapper'),
  btnView3d: document.getElementById('btn-view-3d'),
  btnView2d: document.getElementById('btn-view-2d'),
  twinLiveSimBadge: document.getElementById('twin-live-sim-badge'),
  hudCardController: document.getElementById('hud-card-controller'),
  hudControllerStatus: document.getElementById('hud-controller-status'),
  hudTempVal: document.getElementById('hud-temp-val'),
  hudHumVal: document.getElementById('hud-hum-val'),
  hudGasVal: document.getElementById('hud-gas-val'),
  hudWeightVal: document.getElementById('hud-weight-val'),
  threejsViewport: document.getElementById('threejs-viewport'),
  threejsLabelsLayer: document.getElementById('threejs-labels-layer'),
  floatingShelfNode: document.getElementById('floating-shelf-node'),
  nodeTempVal: document.getElementById('node-temp-val'),
  nodeHumVal: document.getElementById('node-hum-val'),
  nodeGasVal: document.getElementById('node-gas-val'),
  nodeWeightVal: document.getElementById('node-weight-val'),

  // Module 2: Monitoring Cards
  valTrayTemp: document.getElementById('val-tray-temp'),
  trayTempStatusBadge: document.getElementById('tray-temp-status-badge'),
  trayTempFooterNote: document.getElementById('tray-temp-footer-note'),
  valEnvTemp: document.getElementById('val-env-temp'),
  valEnvHum: document.getElementById('val-env-hum'),
  envStatusBadge: document.getElementById('env-status-badge'),
  envFooterNote: document.getElementById('env-footer-note'),
  valMq135Raw: document.getElementById('val-mq135-raw'),
  valMq135Voltage: document.getElementById('val-mq135-voltage'),
  gasStatusBadge: document.getElementById('gas-status-badge'),
  gasFooterNote: document.getElementById('gas-footer-note'),
  valTrayWeight: document.getElementById('val-tray-weight'),
  weightStatusBadge: document.getElementById('weight-status-badge'),
  weightFooterNote: document.getElementById('weight-footer-note'),

  // Emergency Alert
  alertPanel: document.getElementById('alert-panel'),
  alertIconNormal: document.getElementById('alert-icon-normal'),
  alertIconEmergency: document.getElementById('alert-icon-emergency'),
  alertTitle: document.getElementById('alert-title'),
  alertLevelBadge: document.getElementById('alert-level-badge'),
  alertDescription: document.getElementById('alert-description'),
  alertParameterDetail: document.getElementById('alert-parameter-detail'),
  alertTimestamp: document.getElementById('alert-timestamp'),

  // Chart
  chartSubtitle: document.getElementById('chart-mode-subtitle'),
  btnChartModeEnv: document.getElementById('btn-chart-mode-env'),
  btnChartModeWeight: document.getElementById('btn-chart-mode-weight'),
  chartRangeBtns: document.querySelectorAll('.range-btn[data-range]'),
  btnResetChart: document.getElementById('btn-reset-chart'),
  telemetryCanvas: document.getElementById('telemetry-chart'),
  chartLegend: document.getElementById('chart-legend'),
  chartSampleCount: document.getElementById('chart-sample-count'),

  // Live Serial Terminal
  serialTerminal: document.getElementById('serial-terminal'),
  consoleLed: document.getElementById('console-led'),
  packetCounter: document.getElementById('packet-counter'),
  chkAutoscroll: document.getElementById('chk-autoscroll'),
  btnClearConsole: document.getElementById('btn-clear-console'),

  // Module 3: Products
  btnOpenAddProduct: document.getElementById('btn-open-add-product'),
  btnEmptyAddProduct: document.getElementById('btn-empty-add-product'),
  inputSearchProduct: document.getElementById('input-search-product'),
  filterCategory: document.getElementById('filter-category'),
  filterExpiry: document.getElementById('filter-expiry'),
  filterRisk: document.getElementById('filter-risk'),
  productsTableBody: document.getElementById('products-table-body'),
  productsEmptyState: document.getElementById('products-empty-state'),

  // Module 4: Risk Analysis
  riskCountSafe: document.getElementById('risk-count-safe'),
  riskCountInspect: document.getElementById('risk-count-inspect'),
  riskCountSellFirst: document.getElementById('risk-count-sell-first'),
  riskCountRemove: document.getElementById('risk-count-remove'),
  riskTableBody: document.getElementById('risk-table-body'),
  riskCurrentTempBadge: document.getElementById('risk-current-temp-badge'),

  // Module 5: History
  histTotalSamples: document.getElementById('hist-total-samples'),
  histLatestTimestamp: document.getElementById('hist-latest-timestamp'),
  histLatestDate: document.getElementById('hist-latest-date'),
  histWarningsCount: document.getElementById('hist-warnings-count'),
  histActiveSourceText: document.getElementById('hist-active-source-text'),
  inputSearchHistory: document.getElementById('input-search-history'),
  filterHistorySource: document.getElementById('filter-history-source'),
  filterHistoryWarning: document.getElementById('filter-history-warning'),
  historyTableBody: document.getElementById('history-table-body'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnRefreshHistory: document.getElementById('btn-refresh-history'),
  btnLoadMoreHistory: document.getElementById('btn-load-more-history'),
  historyShowingLabel: document.getElementById('history-showing-label'),

  // Modals
  productModal: document.getElementById('product-modal'),
  productModalTitle: document.getElementById('product-modal-title'),
  productForm: document.getElementById('product-form'),
  inputProductId: document.getElementById('input-product-id'),
  inputProductName: document.getElementById('input-product-name'),
  inputProductCategory: document.getElementById('input-product-category'),
  inputProductQuantity: document.getElementById('input-product-quantity'),
  inputProductUnit: document.getElementById('input-product-unit'),
  inputProductWeight: document.getElementById('input-product-weight'),
  inputProductTemp: document.getElementById('input-product-temp'),
  inputProductStorageDate: document.getElementById('input-product-storage-date'),
  inputProductExpiryDate: document.getElementById('input-product-expiry-date'),
  inputProductDescription: document.getElementById('input-product-description'),
  btnCloseProductModal: document.getElementById('btn-close-product-modal'),
  btnCancelProduct: document.getElementById('btn-cancel-product'),

  productViewModal: document.getElementById('product-view-modal'),
  productViewContent: document.getElementById('product-view-content'),
  btnCloseViewModal: document.getElementById('btn-close-view-modal'),
  btnCloseView: document.getElementById('btn-close-view'),
  btnViewEdit: document.getElementById('btn-view-edit'),

  settingsModal: document.getElementById('settings-modal'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  settingsForm: document.getElementById('settings-form'),
  inputTempWarning: document.getElementById('input-temp-warning'),
  inputTempCritical: document.getElementById('input-temp-critical'),
  inputMq135Warning: document.getElementById('input-mq135-warning'),
  inputMq135Critical: document.getElementById('input-mq135-critical'),
  inputSnapshotInterval: document.getElementById('input-snapshot-interval'),
  btnResetThresholds: document.getElementById('btn-reset-thresholds')
};

// ==========================================
// 3. INITIALIZATION & SETUP
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  loadSavedSettings();
  setupNavigation();
  setupEventListeners();
  checkWebSerialSupport();
  resetTelemetryState();

  // Initialize Interactive 3D Cold-Room Digital Twin
  initThreeJsColdRoom();

  // Initialize Canvas Chart
  initCanvasChart();

  // Setup Firebase Cloud Firestore
  setupFirebaseIntegration();

  // Start Cloud Snapshot Timer
  startSnapshotScheduler();
});

function loadSavedSettings() {
  try {
    const saved = localStorage.getItem('trayvanta_settings');
    if (saved) {
      thresholds = { ...DEFAULT_THRESHOLDS, ...JSON.parse(saved) };
    }
  } catch (e) {
    console.warn('Could not load thresholds from localStorage:', e);
  }
  updateThresholdDisplayHints();
}

function saveSettings() {
  try {
    localStorage.setItem('trayvanta_settings', JSON.stringify(thresholds));
    saveAppSettings(thresholds);
  } catch (e) {
    console.warn('Could not save settings:', e);
  }
  updateThresholdDisplayHints();
}

function updateThresholdDisplayHints() {
  if (dom.trayTempFooterNote) {
    dom.trayTempFooterNote.textContent = `Thresholds: < ${thresholds.tempWarning.toFixed(1)}°C Normal | > ${thresholds.tempCritical.toFixed(1)}°C Critical`;
  }
  if (dom.gasFooterNote) {
    dom.gasFooterNote.textContent = `Warning: > ${thresholds.mq135Warning} ADC | Critical: > ${thresholds.mq135Critical} ADC`;
  }
}

function setupNavigation() {
  dom.navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      const pageId = btn.getAttribute('data-page');
      switchPage(pageId);
      closeMobileSidebar();
    });
  });

  dom.btnNavActions.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-target');
      switchPage(target);
    });
  });

  // Mobile sidebar controls
  if (dom.btnSidebarToggle) {
    dom.btnSidebarToggle.addEventListener('click', openMobileSidebar);
  }
  if (dom.btnSidebarClose) {
    dom.btnSidebarClose.addEventListener('click', closeMobileSidebar);
  }
  if (dom.sidebarBackdrop) {
    dom.sidebarBackdrop.addEventListener('click', closeMobileSidebar);
  }
}

function openMobileSidebar() {
  dom.sidebar.classList.add('sidebar-open');
  dom.sidebarBackdrop.classList.remove('hidden');
}

function closeMobileSidebar() {
  dom.sidebar.classList.remove('sidebar-open');
  dom.sidebarBackdrop.classList.add('hidden');
}

function switchPage(pageId) {
  activePage = pageId;

  // Update Navigation Active State
  dom.navItems.forEach((btn) => {
    if (btn.getAttribute('data-page') === pageId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update Section Visibility
  dom.pageSections.forEach((sec) => {
    if (sec.id === `page-${pageId}`) {
      sec.classList.add('active');
    } else {
      sec.classList.remove('active');
    }
  });

  // Update Breadcrumb
  const titles = {
    'digital-twin': 'Digital Twin',
    'monitoring': 'Live Monitoring',
    'products': 'Inventory & Products',
    'risk-analysis': 'Risk Analysis',
    'history': 'History & Export'
  };
  dom.headerPageTitle.textContent = titles[pageId] || 'Dashboard';

  // Trigger page-specific refreshes
  if (pageId === 'risk-analysis') {
    renderRiskAnalysisModule();
  } else if (pageId === 'history') {
    loadHistoricalRecordsView();
  } else if (pageId === 'digital-twin') {
    updateDigitalTwinVisuals();
    setTimeout(() => handleThreeResize(), 60);
  } else if (pageId === 'monitoring') {
    requestAnimationFrame(renderTelemetryChart);
  }
}

// ==========================================
// 4. FIREBASE CLOUD FIRESTORE SETUP
// ==========================================
async function setupFirebaseIntegration() {
  onFirebaseStatusChange((status, message) => {
    dom.firebaseStatusLabel.textContent = status === 'CONNECTED' ? 'Firestore Active' : (status === 'ERROR' ? 'Cloud: Error' : 'Cloud: Standby');
    dom.firebaseStatusPill.className = `firebase-status-pill status-${status.toLowerCase()}`;
    dom.firebaseStatusPill.title = message;
  });

  await initFirebase();

  // Subscribe to real-time products collection
  subscribeProducts((products) => {
    productsList = products || [];
    updateInventoryCounts();
    renderProductsTable();
    renderRiskAnalysisModule();
    updateDigitalTwinVisuals();
  });
}

function updateInventoryCounts() {
  const count = productsList.length;
  if (dom.trayItemCountBadge) dom.trayItemCountBadge.textContent = `${count} Items`;
  if (dom.inventoryTotalBadge) dom.inventoryTotalBadge.textContent = count;
}

// ==========================================
// 5. WEB SERIAL API HARDWARE CONNECTION
// ==========================================
function checkWebSerialSupport() {
  if (!('serial' in navigator)) {
    dom.browserWarningBanner.classList.remove('hidden');
    dom.btnConnect.disabled = true;
    dom.btnConnect.title = 'Web Serial API is not supported in this browser.';
    logTerminal('SYSTEM', 'Notice: Web Serial API not supported in this browser. Use Google Chrome / Edge on desktop, or run Demo Mode.', 'terminal-warning');
    return false;
  }
  return true;
}

function setupEventListeners() {
  // Web Serial Connect / Disconnect
  dom.btnConnect.addEventListener('click', handleConnectESP32);
  dom.btnDisconnect.addEventListener('click', handleDisconnectESP32);
  dom.btnClearConsole.addEventListener('click', () => {
    dom.serialTerminal.innerHTML = '';
    logTerminal('SYSTEM', 'Console cleared.', 'terminal-system');
  });

  // Demo Simulation Mode Buttons
  dom.btnDemoMode.addEventListener('click', toggleDemoMode);
  dom.btnSimStop.addEventListener('click', stopDemoMode);
  dom.btnSimReset.addEventListener('click', resetSimulationValues);
  dom.btnSimTempRise.addEventListener('click', triggerSimulatedTemperatureRise);

  // Digital Twin View Mode Toggles (3D vs 2D)
  if (dom.btnView3d) {
    dom.btnView3d.addEventListener('click', () => setDigitalTwinViewMode('3D'));
  }
  if (dom.btnView2d) {
    dom.btnView2d.addEventListener('click', () => setDigitalTwinViewMode('2D'));
  }

  // Window Resize Listener for 3D Viewport
  window.addEventListener('resize', () => {
    handleThreeResize();
  });

  // Chart Controls
  dom.btnChartModeEnv.addEventListener('click', () => setChartMode('env'));
  dom.btnChartModeWeight.addEventListener('click', () => setChartMode('weight'));
  dom.chartRangeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      dom.chartRangeBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      chartRangeSeconds = parseInt(btn.getAttribute('data-range'), 10);
      renderTelemetryChart();
    });
  });
  dom.btnResetChart.addEventListener('click', () => {
    chartHistoryPoints = [];
    renderTelemetryChart();
  });

  // Inventory Filters
  dom.inputSearchProduct.addEventListener('input', renderProductsTable);
  dom.filterCategory.addEventListener('change', renderProductsTable);
  dom.filterExpiry.addEventListener('change', renderProductsTable);
  dom.filterRisk.addEventListener('change', renderProductsTable);

  // Product Add / Edit Modal
  dom.btnOpenAddProduct.addEventListener('click', () => openProductModal());
  if (dom.btnEmptyAddProduct) {
    dom.btnEmptyAddProduct.addEventListener('click', () => openProductModal());
  }
  dom.btnCloseProductModal.addEventListener('click', closeProductModal);
  dom.btnCancelProduct.addEventListener('click', closeProductModal);
  dom.productModal.addEventListener('click', (e) => {
    if (e.target === dom.productModal) closeProductModal();
  });
  dom.productForm.addEventListener('submit', handleProductFormSubmit);

  // Product View Modal
  dom.btnCloseViewModal.addEventListener('click', closeProductViewModal);
  dom.btnCloseView.addEventListener('click', closeProductViewModal);
  dom.productViewModal.addEventListener('click', (e) => {
    if (e.target === dom.productViewModal) closeProductViewModal();
  });
  dom.btnViewEdit.addEventListener('click', () => {
    const id = dom.btnViewEdit.getAttribute('data-product-id');
    closeProductViewModal();
    if (id) openProductModal(id);
  });

  // History Controls
  dom.btnExportCsv.addEventListener('click', exportHistoryToCsv);
  dom.btnRefreshHistory.addEventListener('click', loadHistoricalRecordsView);
  dom.btnLoadMoreHistory.addEventListener('click', () => loadHistoricalRecordsView(250));
  dom.inputSearchHistory.addEventListener('input', renderHistoryTable);
  dom.filterHistorySource.addEventListener('change', renderHistoryTable);
  dom.filterHistoryWarning.addEventListener('change', renderHistoryTable);

  // Settings Modal Handlers
  dom.btnSettings.addEventListener('click', openSettingsModal);
  dom.btnCloseModal.addEventListener('click', closeSettingsModal);
  dom.settingsModal.addEventListener('click', (e) => {
    if (e.target === dom.settingsModal) closeSettingsModal();
  });
  dom.settingsForm.addEventListener('submit', handleSettingsFormSubmit);
  dom.btnResetThresholds.addEventListener('click', handleResetThresholds);

  // Physical Cable Removal Event
  if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', (event) => {
      if (port && event.target === port) {
        logTerminal('SYSTEM', 'ESP32 disconnected: USB cable was physically unplugged.', 'terminal-error');
        handleDisconnectESP32();
      }
    });
  }

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeProductModal();
      closeProductViewModal();
      closeSettingsModal();
      closeMobileSidebar();
    }
  });

  // Window Resize
  window.addEventListener('resize', () => {
    renderTelemetryChart();
  });
}

async function handleConnectESP32() {
  if (!checkWebSerialSupport()) return;

  // If Demo Mode is running, automatically stop simulation
  if (isDemoMode) {
    stopDemoMode();
    logTerminal('SYSTEM', 'Demo simulation halted to connect physical ESP32 hardware.', 'terminal-system');
  }

  setConnectionUiState('CONNECTING');
  logTerminal('SYSTEM', 'Requesting serial port... Please select your ESP32 in the browser picker.', 'terminal-system');

  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });

    isHardwareConnected = true;
    setConnectionUiState('CONNECTED');
    setDataSourceMode('LIVE');
    logTerminal('SYSTEM', 'ESP32 Connected at 115200 baud. Receiving real-time telemetry...', 'terminal-system');

    keepReading = true;
    readSerialStream();
  } catch (error) {
    console.error('Serial Connection Error:', error);
    setConnectionUiState('DISCONNECTED');

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
  isHardwareConnected = false;

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
    setConnectionUiState('DISCONNECTED');
    resetTelemetryState();
  }
}

function setConnectionUiState(state) {
  if (state === 'CONNECTED') {
    dom.connectionStatusPill.className = 'status-pill status-connected';
    dom.statusLabel.textContent = 'ESP32 CONNECTED';
    dom.btnConnect.classList.add('hidden');
    dom.btnDisconnect.classList.remove('hidden');
    dom.consoleLed.classList.add('active');
  } else if (state === 'CONNECTING') {
    dom.connectionStatusPill.className = 'status-pill status-connecting';
    dom.statusLabel.textContent = 'Connecting...';
    dom.btnConnect.disabled = true;
    dom.btnConnectLabel.textContent = 'CONNECTING...';
    dom.btnDisconnect.classList.add('hidden');
    dom.consoleLed.classList.remove('active');
  } else {
    dom.connectionStatusPill.className = 'status-pill status-disconnected';
    dom.statusLabel.textContent = 'ESP32 Disconnected';
    dom.btnConnect.disabled = false;
    dom.btnConnectLabel.textContent = 'CONNECT ESP32';
    dom.btnConnect.classList.remove('hidden');
    dom.btnDisconnect.classList.add('hidden');
    dom.consoleLed.classList.remove('active');
  }
}

function setDataSourceMode(source) {
  currentTelemetry.dataSource = source;
  if (source === 'LIVE') {
    dom.dataSourceBadge.className = 'data-mode-badge badge-live';
    dom.dataSourceLabel.textContent = 'LIVE DATA';
    dom.histActiveSourceText.textContent = 'LIVE HARDWARE';
  } else {
    dom.dataSourceBadge.className = 'data-mode-badge badge-simulated';
    dom.dataSourceLabel.textContent = 'SIMULATED DATA';
    dom.histActiveSourceText.textContent = 'SIMULATED DEMO';
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
      if (done) break;
      if (value) {
        lineBuffer += value;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop(); // Keep trailing fragment

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length > 0) {
            processIncomingSerialLine(trimmed);
          }
        }
      }
    }
  } catch (error) {
    if (keepReading) {
      console.error('Serial read error:', error);
      logTerminal('SYSTEM', `Serial stream error: ${error.message}`, 'terminal-error');
      handleDisconnectESP32();
    }
  } finally {
    if (reader) {
      reader.releaseLock();
    }
  }
}

function processIncomingSerialLine(line) {
  if (!line.startsWith('{') || !line.endsWith('}')) {
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
  dom.packetCounter.textContent = `Packets: ${packetCount}`;

  // Update Telemetry State from ESP32 JSON payload
  currentTelemetry.environmentTemperature = data.environment_temperature !== undefined ? data.environment_temperature : null;
  currentTelemetry.environmentHumidity = data.environment_humidity !== undefined ? data.environment_humidity : null;
  currentTelemetry.refrigeratorTemperature = data.refrigerator_temperature !== undefined ? data.refrigerator_temperature : null;
  currentTelemetry.mq135Raw = data.mq135_raw !== undefined ? data.mq135_raw : null;
  currentTelemetry.mq135Voltage = data.mq135_voltage !== undefined ? data.mq135_voltage : null;

  // IMPORTANT: Preserve existing Load Cell demonstration calculation!
  // Uses weight_kg received directly from ESP32. Does NOT display raw HX711.
  currentTelemetry.trayWeightKg = data.weight_kg !== undefined ? data.weight_kg : null;
  currentTelemetry.dataSource = 'LIVE';
  currentTelemetry.timestamp = new Date().toISOString();

  // Evaluate Emergency Alerts & Warnings
  evaluateSystemHealthAndAlerts();

  // Update All Visual Modules
  updateAllDashboardVisuals();

  // Record point for interactive chart
  recordTelemetryForChart();

  // Append formatted entry to Live Serial Terminal
  logFormattedSerialTelemetry(data);
}

// ==========================================
// 7. SYSTEM HEALTH & EMERGENCY ALERTS
// ==========================================
function evaluateSystemHealthAndAlerts() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString();

  const temp = currentTelemetry.refrigeratorTemperature;
  const gasRaw = currentTelemetry.mq135Raw;

  let trayTempStatus = 'NORMAL';
  if (temp === null || isNaN(temp)) {
    trayTempStatus = 'DISCONNECTED';
  } else if (temp >= thresholds.tempCritical) {
    trayTempStatus = 'CRITICAL';
  } else if (temp >= thresholds.tempWarning) {
    trayTempStatus = 'WARNING';
  }

  let gasStatus = 'NORMAL';
  if (gasRaw === null || isNaN(gasRaw)) {
    gasStatus = 'DISCONNECTED';
  } else if (gasRaw >= thresholds.mq135Critical) {
    gasStatus = 'CRITICAL';
  } else if (gasRaw >= thresholds.mq135Warning) {
    gasStatus = 'WARNING';
  }

  // Update persistence counters to prevent false alarms
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

  // Determine Overall State
  let nextState = 'NORMAL';

  if (consecutiveGasCritical >= PERSISTENCE_THRESHOLD) {
    nextState = 'CRITICAL';
    currentEmergencyState = 'CRITICAL';
    lastEmergencyTimestamp = timeStr;

    dom.alertPanel.className = 'alert-panel alert-panel-critical';
    dom.alertIconNormal.classList.add('hidden');
    dom.alertIconEmergency.classList.remove('hidden');
    dom.alertTitle.textContent = '⚠ POSSIBLE FOOD SPOILAGE / GAS ANOMALY ALERT';
    dom.alertLevelBadge.className = 'alert-level-badge level-critical';
    dom.alertLevelBadge.textContent = 'CRITICAL ANOMALY';
    dom.alertDescription.textContent =
      'MQ135 air-quality sensor detected elevated atmospheric variation exceeding safe critical threshold. Physical tray inspection recommended.';
    dom.alertParameterDetail.textContent =
      `Parameter: MQ135 Gas | Current ADC: ${gasRaw} (${Number(currentTelemetry.mq135Voltage || 0).toFixed(2)} V) | Critical Threshold: > ${thresholds.mq135Critical}`;
    dom.alertTimestamp.textContent = `Alert Triggered: ${timeStr}`;

  } else if (consecutiveTempCritical >= PERSISTENCE_THRESHOLD) {
    nextState = 'CRITICAL';
    currentEmergencyState = 'CRITICAL';
    lastEmergencyTimestamp = timeStr;

    dom.alertPanel.className = 'alert-panel alert-panel-critical';
    dom.alertIconNormal.classList.add('hidden');
    dom.alertIconEmergency.classList.remove('hidden');
    dom.alertTitle.textContent = '⚠ REFRIGERATOR TEMPERATURE ALERT';
    dom.alertLevelBadge.className = 'alert-level-badge level-critical';
    dom.alertLevelBadge.textContent = 'CRITICAL TEMP';
    dom.alertDescription.textContent =
      'Internal tray temperature exceeded critical threshold. Prolonged elevated temperature accelerates spoilage.';
    dom.alertParameterDetail.textContent =
      `Parameter: Tray Temp | Current: ${Number(temp).toFixed(2)} °C | Critical Threshold: > ${thresholds.tempCritical.toFixed(1)} °C`;
    dom.alertTimestamp.textContent = `Alert Triggered: ${timeStr}`;

  } else if (gasStatus === 'WARNING' || trayTempStatus === 'WARNING') {
    nextState = 'WARNING';
    currentEmergencyState = 'WARNING';

    dom.alertPanel.className = 'alert-panel alert-panel-warning';
    dom.alertIconNormal.classList.add('hidden');
    dom.alertIconEmergency.classList.remove('hidden');
    dom.alertTitle.textContent = 'SYSTEM WARNING: ELEVATED READINGS';
    dom.alertLevelBadge.className = 'alert-level-badge level-warning';
    dom.alertLevelBadge.textContent = 'WARNING';

    if (gasStatus === 'WARNING') {
      dom.alertDescription.textContent =
        'Notice: Gas/air-quality sensor reading is moderately elevated above baseline.';
      dom.alertParameterDetail.textContent =
        `Parameter: MQ135 Gas | Current ADC: ${gasRaw} | Warning Threshold: > ${thresholds.mq135Warning}`;
    } else {
      dom.alertDescription.textContent =
        'Notice: Refrigerator tray temperature is slightly above optimal preservation target.';
      dom.alertParameterDetail.textContent =
        `Parameter: Tray Temp | Current: ${Number(temp).toFixed(2)} °C | Warning Threshold: > ${thresholds.tempWarning.toFixed(1)} °C`;
    }
    dom.alertTimestamp.textContent = `Last Checked: ${timeStr}`;

  } else {
    nextState = 'NORMAL';
    currentEmergencyState = 'NORMAL';

    dom.alertPanel.className = 'alert-panel alert-panel-normal';
    dom.alertIconNormal.classList.remove('hidden');
    dom.alertIconEmergency.classList.add('hidden');
    dom.alertTitle.textContent = 'SYSTEM STATUS: ALL PARAMETERS NORMAL';
    dom.alertLevelBadge.className = 'alert-level-badge level-normal';
    dom.alertLevelBadge.textContent = 'NORMAL';
    dom.alertDescription.textContent =
      'All tray parameters are within acceptable safe ranges. No gas anomalies or temperature deviations detected.';
    dom.alertParameterDetail.textContent = 'Monitored: DS18B20, DHT22, MQ135, HX711';
    dom.alertTimestamp.textContent = lastEmergencyTimestamp ? `Prior Alert Cleared: ${lastEmergencyTimestamp}` : `Last Checked: ${timeStr}`;
  }

  currentTelemetry.warningStatus = nextState;

  // Trigger immediate cloud snapshot if warning state transitioned
  if (nextState !== previousWarningState && (isHardwareConnected || isDemoMode)) {
    previousWarningState = nextState;
    triggerImmediateCloudSnapshot('STATE_CHANGE');
    
    // Save Alert log
    if (nextState !== 'NORMAL') {
      saveAlert({
        deviceId: thresholds.deviceId,
        alertType: gasStatus === 'CRITICAL' || gasStatus === 'WARNING' ? 'GAS_ANOMALY' : 'TEMPERATURE',
        message: dom.alertTitle.textContent,
        severity: nextState,
        reading: gasStatus === 'CRITICAL' ? gasRaw : temp,
        source: currentTelemetry.dataSource
      });
    }
  }
}

// ==========================================
// 8. DASHBOARD VISUALS UPDATER
// ==========================================
function updateAllDashboardVisuals() {
  const temp = currentTelemetry.refrigeratorTemperature;
  const hum = currentTelemetry.environmentHumidity;
  const envTemp = currentTelemetry.environmentTemperature;
  const gasRaw = currentTelemetry.mq135Raw;
  const gasVolt = currentTelemetry.mq135Voltage;
  const weight = currentTelemetry.trayWeightKg;

  const tempValid = temp !== null && !isNaN(temp);
  const humValid = hum !== null && !isNaN(hum);
  const weightValid = weight !== null && !isNaN(weight);
  const gasValid = gasRaw !== null && !isNaN(gasRaw);

  // --- 1. Top Summary Cards (Digital Twin) ---
  if (tempValid) {
    dom.twinValTemp.textContent = Number(temp).toFixed(2);
    setChipBadge(dom.twinStatusTemp, temp >= thresholds.tempCritical ? 'Critical' : (temp >= thresholds.tempWarning ? 'Warning' : 'Normal'), temp >= thresholds.tempCritical ? 'status-chip-critical' : (temp >= thresholds.tempWarning ? 'status-chip-warning' : 'status-chip-normal'));
  } else {
    dom.twinValTemp.textContent = '--';
    setChipBadge(dom.twinStatusTemp, 'Offline', 'status-chip-critical');
  }

  if (humValid) {
    dom.twinValHum.textContent = Number(hum).toFixed(2);
    setChipBadge(dom.twinStatusHum, 'Normal', 'status-chip-normal');
  } else {
    dom.twinValHum.textContent = '--';
    setChipBadge(dom.twinStatusHum, 'Offline', 'status-chip-critical');
  }

  if (weightValid) {
    dom.twinValWeight.textContent = Number(weight).toFixed(2);
    setChipBadge(dom.twinStatusWeight, 'Connected', 'status-chip-normal');
  } else {
    dom.twinValWeight.textContent = '--';
    setChipBadge(dom.twinStatusWeight, 'Offline', 'status-chip-critical');
  }

  // System Status Card
  dom.twinOverallTitle.textContent = currentEmergencyState;
  dom.twinOverallTitle.style.color = currentEmergencyState === 'CRITICAL' ? 'var(--status-critical)' : (currentEmergencyState === 'WARNING' ? 'var(--status-warning)' : 'var(--status-normal)');
  setChipBadge(dom.twinOverallChip, currentEmergencyState, currentEmergencyState === 'CRITICAL' ? 'status-chip-critical' : (currentEmergencyState === 'WARNING' ? 'status-chip-warning' : 'status-chip-normal'));
  dom.twinMq135Sub.textContent = gasValid ? `MQ135 Gas: ${gasRaw} ADC (${Number(gasVolt || 0).toFixed(2)}V)` : 'MQ135 Gas: Offline';

  // Ambient Glow in Digital Twin
  if (currentEmergencyState === 'CRITICAL') {
    dom.refrigeratorAmbientGlow.className = 'ambient-glow glow-critical';
  } else if (currentEmergencyState === 'WARNING') {
    dom.refrigeratorAmbientGlow.className = 'ambient-glow glow-warning';
  } else {
    dom.refrigeratorAmbientGlow.className = 'ambient-glow';
  }

  // Tray Front Acrylic Telemetry Overlay
  dom.acrylicTemp.textContent = tempValid ? `${Number(temp).toFixed(2)}°C` : '--°C';
  dom.acrylicHum.textContent = humValid ? `${Number(hum).toFixed(2)}%` : '--%';
  dom.acrylicWeight.textContent = weightValid ? `${Number(weight).toFixed(2)} KG` : '-- KG';

  // Tray Load Gauge (5KG capacity)
  if (weightValid) {
    const pct = Math.min(100, Math.max(0, (Number(weight) / 5.0) * 100));
    dom.twinTrayGaugeFill.style.width = `${pct.toFixed(1)}%`;
    dom.twinTrayGaugeText.textContent = `${Number(weight).toFixed(2)} / 5.00 KG`;
  } else {
    dom.twinTrayGaugeFill.style.width = '0%';
    dom.twinTrayGaugeText.textContent = '0.00 / 5.00 KG';
  }

  // --- 3D Digital Twin HUD & Shelf Node Metrics ---
  update3DDigitalTwinHUD(
    tempValid ? temp : null,
    humValid ? hum : null,
    gasValid ? gasRaw : null,
    weightValid ? weight : null
  );

  // --- 2. Monitoring Module Cards ---
  // Temperature
  if (tempValid) {
    dom.valTrayTemp.textContent = Number(temp).toFixed(2);
    setCardBadge(dom.trayTempStatusBadge, temp >= thresholds.tempCritical ? 'Critical' : (temp >= thresholds.tempWarning ? 'Warning' : 'Normal'), temp >= thresholds.tempCritical ? 'status-badge-critical' : (temp >= thresholds.tempWarning ? 'status-badge-warning' : 'status-badge-normal'));
  } else {
    dom.valTrayTemp.textContent = '--';
    setCardBadge(dom.trayTempStatusBadge, 'Disconnected', 'status-badge-error');
  }

  // Environment (DHT22)
  if (humValid) dom.valEnvHum.textContent = Number(hum).toFixed(2);
  else dom.valEnvHum.textContent = '--';
  if (envTemp !== null && !isNaN(envTemp)) dom.valEnvTemp.textContent = Number(envTemp).toFixed(2);
  else dom.valEnvTemp.textContent = '--';
  setCardBadge(dom.envStatusBadge, (humValid && envTemp !== null) ? 'Normal' : 'Sensor Error', (humValid && envTemp !== null) ? 'status-badge-normal' : 'status-badge-error');

  // MQ135 Gas
  if (gasValid) {
    dom.valMq135Raw.textContent = gasRaw;
    dom.valMq135Voltage.textContent = gasVolt !== null ? Number(gasVolt).toFixed(2) : '--';
    setCardBadge(dom.gasStatusBadge, gasRaw >= thresholds.mq135Critical ? 'Critical Anomaly' : (gasRaw >= thresholds.mq135Warning ? 'Warning' : 'Normal'), gasRaw >= thresholds.mq135Critical ? 'status-badge-critical' : (gasRaw >= thresholds.mq135Warning ? 'status-badge-warning' : 'status-badge-normal'));
  } else {
    dom.valMq135Raw.textContent = '--';
    dom.valMq135Voltage.textContent = '--';
    setCardBadge(dom.gasStatusBadge, 'Sensor Error', 'status-badge-error');
  }

  // Tray Weight (KG Only, Never Raw HX711)
  if (weightValid) {
    dom.valTrayWeight.textContent = Number(weight).toFixed(2);
    setCardBadge(dom.weightStatusBadge, 'Connected', 'status-badge-normal');
  } else {
    dom.valTrayWeight.textContent = '--';
    setCardBadge(dom.weightStatusBadge, 'Sensor Error', 'status-badge-error');
  }

  // Sidebar Mini Card
  dom.miniTrayTemp.textContent = tempValid ? `${Number(temp).toFixed(1)} °C` : '-- °C';
  dom.miniTrayWeight.textContent = weightValid ? `${Number(weight).toFixed(2)} KG` : '-- KG';
  dom.miniTrayStatus.textContent = currentEmergencyState;
  dom.miniTrayStatus.style.color = currentEmergencyState === 'CRITICAL' ? 'var(--status-critical)' : (currentEmergencyState === 'WARNING' ? 'var(--status-warning)' : 'var(--status-normal)');

  // Refresh Risk Analysis if active or temp changed
  if (activePage === 'risk-analysis') {
    renderRiskAnalysisModule();
  }
}

function setChipBadge(el, text, className) {
  if (!el) return;
  el.className = `status-chip ${className}`;
  el.textContent = text;
}

function setCardBadge(el, text, className) {
  if (!el) return;
  el.className = `card-status-badge ${className}`;
  el.textContent = text;
}

function resetTelemetryState() {
  currentTelemetry = {
    environmentTemperature: null,
    environmentHumidity: null,
    refrigeratorTemperature: null,
    mq135Raw: null,
    mq135Voltage: null,
    trayWeightKg: null,
    warningStatus: 'NORMAL',
    dataSource: isDemoMode ? 'SIMULATED' : 'LIVE',
    timestamp: null
  };
  consecutiveGasCritical = 0;
  consecutiveTempCritical = 0;
  currentEmergencyState = 'NORMAL';
  updateAllDashboardVisuals();
}

// ==========================================
// 9. INTERACTIVE 3D COLD-ROOM DIGITAL TWIN
// ==========================================
const threeState = {
  initialized: false,
  initAttempts: 0,
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  animFrameId: null,
  evaporatorFan: null,
  shelfNodeAnchor: null,
  shelfLedMesh: null,
  productGroup: null,
  pendingProducts: null,
  halos: [],
  productAnchors: [],
  interactiveMeshes: [],
  hoveredMesh: null,
  originalEmissive: null,
  is3dActive: true
};

let initRetryTimer = null;

function setDigitalTwinViewMode(mode) {
  if (mode === '3D') {
    threeState.is3dActive = true;
    if (dom.btnView3d) dom.btnView3d.classList.add('active');
    if (dom.btnView2d) dom.btnView2d.classList.remove('active');
    if (dom.twin3dWrapper) dom.twin3dWrapper.classList.remove('hidden');
    if (dom.twin2dWrapper) dom.twin2dWrapper.classList.add('hidden');
    if (!threeState.initialized) {
      initThreeJsColdRoom();
    } else {
      setTimeout(() => handleThreeResize(), 50);
    }
  } else {
    threeState.is3dActive = false;
    if (dom.btnView2d) dom.btnView2d.classList.add('active');
    if (dom.btnView3d) dom.btnView3d.classList.remove('active');
    if (dom.twin2dWrapper) dom.twin2dWrapper.classList.remove('hidden');
    if (dom.twin3dWrapper) dom.twin3dWrapper.classList.add('hidden');
    renderDigitalTwinTray();
  }
}

function update3DDigitalTwinHUD(temp, hum, gas, weight) {
  // Floating Top Right HUD Card
  if (dom.hudTempVal) dom.hudTempVal.textContent = temp !== null ? `${Number(temp).toFixed(1)}°C` : '--°C';
  if (dom.hudHumVal) dom.hudHumVal.textContent = hum !== null ? `${Math.round(hum)}%` : '--%';
  if (dom.hudGasVal) dom.hudGasVal.textContent = gas !== null ? `${gas} ppm` : '-- ppm';
  if (dom.hudWeightVal) dom.hudWeightVal.textContent = weight !== null ? `${Number(weight).toFixed(1)} kg` : '-- kg';

  // On-Shelf Telemetry Tag
  if (dom.nodeTempVal) dom.nodeTempVal.textContent = temp !== null ? `${Number(temp).toFixed(1)}°C` : '--°C';
  if (dom.nodeHumVal) dom.nodeHumVal.textContent = hum !== null ? `${Math.round(hum)}%` : '--%';
  if (dom.nodeGasVal) dom.nodeGasVal.textContent = gas !== null ? `${gas} ppm` : '-- ppm';
  if (dom.nodeWeightVal) dom.nodeWeightVal.textContent = weight !== null ? `${Number(weight).toFixed(1)} kg` : '-- kg';

  // Floating Top Left Controller Card
  if (dom.hudControllerStatus) {
    if (isHardwareConnected) {
      dom.hudControllerStatus.textContent = 'ESP32 LIVE • PORT ACTIVE (115200 BAUD)';
    } else if (isDemoMode) {
      dom.hudControllerStatus.textContent = 'SIMULATION MODE • DEMO TELEMETRY';
    } else {
      dom.hudControllerStatus.textContent = 'LOCAL MODEL • NO HARDWARE';
    }
  }

  // Live / Sim Badge
  if (dom.twinLiveSimBadge) {
    if (isHardwareConnected) {
      dom.twinLiveSimBadge.className = 'twin-live-badge badge-live';
      dom.twinLiveSimBadge.textContent = 'ESP32 LIVE';
    } else if (isDemoMode) {
      dom.twinLiveSimBadge.className = 'twin-live-badge badge-sim';
      dom.twinLiveSimBadge.textContent = 'LIVE SIMULATION';
    } else {
      dom.twinLiveSimBadge.className = 'twin-live-badge badge-sim';
      dom.twinLiveSimBadge.textContent = 'STANDBY MODEL';
    }
  }

  // Update Status LED on 3D ESP32 Node
  if (threeState.shelfLedMesh && threeState.shelfLedMesh.material) {
    if (isHardwareConnected) {
      threeState.shelfLedMesh.material.color.setHex(0x10b981); // Emerald Green
    } else if (isDemoMode) {
      threeState.shelfLedMesh.material.color.setHex(0x00f2fe); // Cyan
    } else {
      threeState.shelfLedMesh.material.color.setHex(0x64748b); // Idle Slate
    }
  }
}

function updateDigitalTwinVisuals() {
  renderDigitalTwinTray();
  render3DProducts(productsList);
}

function initThreeJsColdRoom() {
  if (typeof THREE === 'undefined') {
    if (threeState.initAttempts < 30) {
      threeState.initAttempts++;
      clearTimeout(initRetryTimer);
      initRetryTimer = setTimeout(initThreeJsColdRoom, 150);
      return;
    }
    console.warn('Three.js library is not available after retries.');
    return;
  }

  const viewport = dom.threejsViewport;
  if (!viewport) return;

  // Remove only previous canvas element if existing
  const oldCanvas = viewport.querySelector('canvas');
  if (oldCanvas) oldCanvas.remove();

  const width = viewport.clientWidth || viewport.offsetWidth || 900;
  const height = viewport.clientHeight || viewport.offsetHeight || 520;

  // Scene & Fog with rich atmospheric refrigeration cold-room color
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070e1c);
  scene.fog = new THREE.FogExp2(0x070e1c, 0.04);

  // Camera
  const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
  camera.position.set(3.4, 2.7, 4.4);
  camera.lookAt(0, 0.45, 0);

  // Renderer with fallback
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'default'
    });
  } catch (err) {
    console.warn('WebGL default initialization fallback:', err);
    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
  }

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.top = '0';
  renderer.domElement.style.left = '0';
  renderer.domElement.style.zIndex = '1';
  viewport.insertBefore(renderer.domElement, viewport.firstChild);

  // OrbitControls
  let controls = null;
  if (typeof THREE.OrbitControls !== 'undefined') {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 1.8;
    controls.maxDistance = 8.5;
    controls.maxPolarAngle = Math.PI / 2 + 0.02; // Keep camera above floor
    controls.target.set(0, 0.45, 0);
    controls.update();
  }

  // Lighting Rig
  const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.9);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(4, 7, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 16;
  keyLight.shadow.camera.left = -3;
  keyLight.shadow.camera.right = 3;
  keyLight.shadow.camera.top = 3;
  keyLight.shadow.camera.bottom = -3;
  keyLight.shadow.bias = -0.001;
  scene.add(keyLight);

  // Overhead Neon LED Strip Light (Cold Cyan)
  const ceilingLight = new THREE.PointLight(0x00f2fe, 1.3, 8);
  ceilingLight.position.set(0, 2.5, 0);
  scene.add(ceilingLight);

  // Cool Soft Fill Light
  const fillLight = new THREE.DirectionalLight(0x0284c7, 0.5);
  fillLight.position.set(-4, 3, -2);
  scene.add(fillLight);

  // Build Refrigerator Cold-Room Chamber
  buildColdRoomChamber(scene);

  // Build Shelving System & Load Tray
  buildShelvingSystem(scene);

  // Build On-Shelf ESP32 Hardware Twin Node
  buildShelfTelemetryNode(scene);

  // Product Group for Dynamic 3D Food Items
  const productGroup = new THREE.Group();
  scene.add(productGroup);

  // Cache Three.js state
  threeState.scene = scene;
  threeState.camera = camera;
  threeState.renderer = renderer;
  threeState.controls = controls;
  threeState.productGroup = productGroup;
  threeState.initialized = true;

  // Setup Raycasting & Pointer Interactivity
  setupThreeInteraction(viewport, renderer, camera);

  // Render Initial Products (or any pending products)
  const itemsToRender = threeState.pendingProducts || productsList;
  render3DProducts(itemsToRender);

  // Start Animation Render Loop
  startThreeAnimationLoop();

  // Trigger resize to settle canvas geometry
  setTimeout(() => handleThreeResize(), 80);
}

function buildColdRoomChamber(scene) {
  // Chamber Floor Plate
  const floorGeo = new THREE.PlaneGeometry(5.2, 4.4);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x070e1a,
    metalness: 0.85,
    roughness: 0.35
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  // Cold Air Cyan Floor Grid Helper
  const grid = new THREE.GridHelper(4.4, 14, 0x00f2fe, 0x1e293b);
  grid.position.y = 0.002;
  scene.add(grid);

  // Back Wall (Dark Brushed Stainless Steel Cooling Panel)
  const backWallGeo = new THREE.BoxGeometry(3.8, 2.6, 0.08);
  const backWallMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.85,
    roughness: 0.3
  });
  const backWall = new THREE.Mesh(backWallGeo, backWallMat);
  backWall.position.set(0, 1.35, -1.45);
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Horizontal Cooling Fin Slats
  const finGeo = new THREE.BoxGeometry(3.6, 0.03, 0.04);
  const finMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.9,
    roughness: 0.2
  });
  for (let i = 0; i < 5; i++) {
    const fin = new THREE.Mesh(finGeo, finMat);
    fin.position.set(0, 0.5 + i * 0.24, -1.40);
    scene.add(fin);
  }

  // Evaporator Fan Unit at Upper Center of Back Wall
  const fanHousingGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.06, 32);
  const fanHousingMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.9,
    roughness: 0.2
  });
  const fanHousing = new THREE.Mesh(fanHousingGeo, fanHousingMat);
  fanHousing.rotation.x = Math.PI / 2;
  fanHousing.position.set(0, 2.05, -1.40);
  scene.add(fanHousing);

  // Rotating Fan Blades Group
  const fanGroup = new THREE.Group();
  fanGroup.position.set(0, 2.05, -1.36);

  const bladeGeo = new THREE.BoxGeometry(0.30, 0.05, 0.01);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x00f2fe,
    metalness: 0.8,
    roughness: 0.2
  });

  for (let b = 0; b < 4; b++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.z = (b * Math.PI) / 4;
    fanGroup.add(blade);
  }
  scene.add(fanGroup);
  threeState.evaporatorFan = fanGroup;

  // Chamber Ceiling Panel
  const ceilingGeo = new THREE.BoxGeometry(3.8, 0.08, 2.9);
  const ceilingMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.8,
    roughness: 0.4
  });
  const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
  ceiling.position.set(0, 2.7, 0);
  scene.add(ceiling);

  // Overhead Cyan LED Light Strip Bar
  const neonBarGeo = new THREE.BoxGeometry(2.4, 0.02, 0.16);
  const neonBarMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
  const neonBar = new THREE.Mesh(neonBarGeo, neonBarMat);
  neonBar.position.set(0, 2.65, 0);
  scene.add(neonBar);

  // Side Glass Panels (Frosted Tempered Glass Walls)
  const glassGeo = new THREE.BoxGeometry(0.04, 2.6, 2.9);
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    transparent: true,
    opacity: 0.32,
    roughness: 0.15,
    metalness: 0.9
  });

  const leftGlass = new THREE.Mesh(glassGeo, glassMat);
  leftGlass.position.set(-1.9, 1.35, 0);
  scene.add(leftGlass);

  const rightGlass = new THREE.Mesh(glassGeo, glassMat);
  rightGlass.position.set(1.9, 1.35, 0);
  scene.add(rightGlass);

  // 4 Corner Stainless Chrome Columns
  const postGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.7, 16);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.95,
    roughness: 0.15
  });

  const corners = [
    [-1.9, 1.35, -1.45],
    [1.9, 1.35, -1.45],
    [-1.9, 1.35, 1.45],
    [1.9, 1.35, 1.45]
  ];

  corners.forEach(([x, y, z]) => {
    const col = new THREE.Mesh(postGeo, postMat);
    col.position.set(x, y, z);
    col.castShadow = true;
    scene.add(col);
  });
}

function buildShelvingSystem(scene) {
  // --- PRIMARY LOAD TRAY 01 (Physical Tray with HX711 Load Cell) ---
  const trayGeo = new THREE.BoxGeometry(3.1, 0.06, 1.9);
  const trayMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.85,
    roughness: 0.25
  });
  const tray = new THREE.Mesh(trayGeo, trayMat);
  tray.position.set(0, 0.20, 0.05);
  tray.receiveShadow = true;
  tray.castShadow = true;
  scene.add(tray);

  // Perimeter Cyan Acrylic Border Guard Rail
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x00f2fe,
    transparent: true,
    opacity: 0.45,
    roughness: 0.15
  });

  // Front Rail
  const frontRail = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.08, 0.03), railMat);
  frontRail.position.set(0, 0.26, 0.99);
  scene.add(frontRail);

  // Back Rail
  const backRail = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.08, 0.03), railMat);
  backRail.position.set(0, 0.26, -0.89);
  scene.add(backRail);

  // Left & Right Guard Rails
  const sideRailGeo = new THREE.BoxGeometry(0.03, 0.08, 1.9);
  const leftRail = new THREE.Mesh(sideRailGeo, railMat);
  leftRail.position.set(-1.54, 0.26, 0.05);
  scene.add(leftRail);

  const rightRail = new THREE.Mesh(sideRailGeo, railMat);
  rightRail.position.set(1.54, 0.26, 0.05);
  scene.add(rightRail);

  // 4 Chrome Legs Connecting Tray to Chamber Floor
  const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.20, 16);
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    metalness: 0.9,
    roughness: 0.2
  });

  const legOffsets = [
    [-1.4, 0.10, -0.75],
    [1.4, 0.10, -0.75],
    [-1.4, 0.10, 0.85],
    [1.4, 0.10, 0.85]
  ];

  legOffsets.forEach(([lx, ly, lz]) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(lx, ly, lz);
    leg.castShadow = true;
    scene.add(leg);
  });

  // --- UPPER SHELF RACK (Secondary Storage Area) ---
  const upperShelfGeo = new THREE.BoxGeometry(3.1, 0.03, 1.6);
  const upperShelfMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    transparent: true,
    opacity: 0.65,
    metalness: 0.8,
    roughness: 0.2
  });
  const upperShelf = new THREE.Mesh(upperShelfGeo, upperShelfMat);
  upperShelf.position.set(0, 1.45, -0.05);
  upperShelf.receiveShadow = true;
  upperShelf.castShadow = true;
  scene.add(upperShelf);

  // Upper Shelf Front Trim
  const upperTrim = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, 0.04, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x00f2fe, metalness: 0.9, roughness: 0.2 })
  );
  upperTrim.position.set(0, 1.45, 0.74);
  scene.add(upperTrim);
}

function buildShelfTelemetryNode(scene) {
  // On-Shelf ESP32 Hardware Twin Microcontroller Unit
  const nodeGroup = new THREE.Group();
  nodeGroup.position.set(1.15, 0.25, -0.60);

  // Main Black PCB Enclosure
  const boxGeo = new THREE.BoxGeometry(0.26, 0.05, 0.18);
  const boxMat = new THREE.MeshStandardMaterial({
    color: 0x090d16,
    metalness: 0.8,
    roughness: 0.3
  });
  const nodeBox = new THREE.Mesh(boxGeo, boxMat);
  nodeBox.castShadow = true;
  nodeGroup.add(nodeBox);

  // Gold Pin Header Strip Detail
  const pinGeo = new THREE.BoxGeometry(0.22, 0.015, 0.03);
  const pinMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    metalness: 0.9,
    roughness: 0.2
  });
  const pins = new THREE.Mesh(pinGeo, pinMat);
  pins.position.set(0, 0.028, 0.06);
  nodeGroup.add(pins);

  // Status Indicator LED on Board
  const ledGeo = new THREE.SphereGeometry(0.016, 12, 12);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x00f2fe });
  const led = new THREE.Mesh(ledGeo, ledMat);
  led.position.set(-0.08, 0.03, -0.04);
  nodeGroup.add(led);
  threeState.shelfLedMesh = led;

  // Wi-Fi / Radio Antenna Stub
  const antGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.08, 12);
  const antMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9 });
  const ant = new THREE.Mesh(antGeo, antMat);
  ant.position.set(0.10, 0.05, -0.05);
  nodeGroup.add(ant);

  scene.add(nodeGroup);
  threeState.shelfNodeMesh = nodeGroup;

  // Anchor for 2D Screen Projection of the Floating Shelf Card
  const anchor = new THREE.Object3D();
  anchor.position.set(1.15, 0.36, -0.60);
  scene.add(anchor);
  threeState.shelfNodeAnchor = anchor;
}

function getProduct3DSlotPosition(index, totalCount) {
  // Main Load Tray (HX711 platform at Y = 0.23): fits up to 12 items cleanly
  if (index < 12) {
    if (totalCount === 1) {
      return { x: 0, y: 0.23, z: 0.35, shelf: 'lower' };
    }
    if (totalCount === 2) {
      const xs = [-0.60, 0.60];
      return { x: xs[index], y: 0.23, z: 0.35, shelf: 'lower' };
    }
    if (totalCount === 3) {
      const xs = [-0.85, 0.0, 0.85];
      return { x: xs[index], y: 0.23, z: 0.35, shelf: 'lower' };
    }
    if (totalCount === 4) {
      const xs = [-1.05, -0.35, 0.35, 1.05];
      return { x: xs[index], y: 0.23, z: 0.35, shelf: 'lower' };
    }

    // Grid of 4 columns across 3 rows on the main tray
    const cols = 4;
    const row = Math.floor(index / cols); // 0 (front), 1 (mid), 2 (back)
    const col = index % cols;
    const x = -1.05 + col * 0.70;
    const z = 0.55 - row * 0.45;
    return { x, y: 0.23, z, shelf: 'lower' };
  } else {
    // Upper Storage Rack (at Y = 1.47): fits up to 8 items
    const upperIdx = index - 12;
    const cols = 4;
    const row = Math.floor(upperIdx / cols) % 2;
    const col = upperIdx % cols;
    const x = -1.05 + col * 0.70;
    const z = 0.40 - row * 0.45;
    return { x, y: 1.47, z, shelf: 'upper' };
  }
}

function render3DProducts(products) {
  if (!threeState.initialized || !threeState.productGroup) {
    threeState.pendingProducts = products;
    return;
  }

  // Clear previous product meshes
  while (threeState.productGroup.children.length > 0) {
    const child = threeState.productGroup.children[0];
    threeState.productGroup.remove(child);
  }

  // Clear 2D projected label elements
  if (dom.threejsLabelsLayer) {
    dom.threejsLabelsLayer.innerHTML = '';
  }

  threeState.productAnchors = [];
  threeState.halos = [];
  threeState.interactiveMeshes = [];

  const list = products || [];

  if (list.length === 0) {
    if (dom.threejsLabelsLayer) {
      dom.threejsLabelsLayer.innerHTML = `
        <div class="twin-3d-empty-hint">
          TRAY IS EMPTY • USE "VIEW INVENTORY" OR DEMO MODE TO STORE PRODUCTS
        </div>
      `;
    }
    return;
  }

  const currentTemp = currentTelemetry.refrigeratorTemperature !== null ? Number(currentTelemetry.refrigeratorTemperature) : 4.0;
  const total = list.length;

  list.forEach((prod, idx) => {
    const slot = getProduct3DSlotPosition(idx, total);
    const risk = evaluateProductRisk(prod, currentTemp);

    // Halo Color & Classification
    let haloColor = 0x00f2fe; // SAFE
    if (risk.classification === 'REMOVE') haloColor = 0xef4444;
    else if (risk.classification === 'SELL FIRST') haloColor = 0xf97316;
    else if (risk.classification === 'INSPECT') haloColor = 0xf59e0b;

    // Glowing Base Halo Disc on Shelf Surface
    const haloGeo = new THREE.RingGeometry(0.18, 0.28, 32);
    const haloMat = new THREE.MeshBasicMaterial({
      color: haloColor,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(slot.x, slot.y + 0.003, slot.z);
    threeState.productGroup.add(halo);

    threeState.halos.push({
      mesh: halo,
      baseColor: haloColor,
      isCritical: risk.classification === 'REMOVE'
    });

    // 3D Product Mesh
    const productMesh = createProduct3DMesh(prod, risk);
    productMesh.position.set(slot.x, slot.y, slot.z);
    productMesh.userData = {
      productId: prod.id,
      name: prod.name,
      category: prod.category
    };

    threeState.productGroup.add(productMesh);
    threeState.interactiveMeshes.push(productMesh);

    // Create 2D Projected Floating Tag in DOM Layer
    if (dom.threejsLabelsLayer) {
      const tag = document.createElement('div');
      tag.className = 'twin-3d-tag';
      tag.setAttribute('data-product-id', prod.id);
      tag.title = `Click to view ${escapeHtml(prod.name)} details`;

      const qty = prod.quantity ? `${prod.quantity} ×` : '1 ×';
      tag.innerHTML = `
        <div class="tag-qty">${qty}</div>
        <div class="tag-title">${escapeHtml(prod.name)}</div>
        <div class="tag-sub">${escapeHtml(prod.category || 'Product')}</div>
      `;

      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        openProductViewModal(prod.id);
      });

      dom.threejsLabelsLayer.appendChild(tag);

      threeState.productAnchors.push({
        id: prod.id,
        mesh: productMesh,
        tagEl: tag
      });
    }
  });
}

function createProduct3DMesh(prod, risk) {
  const group = new THREE.Group();
  const category = (prod.category || '').toLowerCase();

  if (category.includes('milk') || category.includes('dairy')) {
    // Milk Carton Packaging with Gabled Peaked Cap
    const cartonGeo = new THREE.BoxGeometry(0.28, 0.44, 0.28);
    const cartonMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      metalness: 0.1,
      roughness: 0.3
    });
    const carton = new THREE.Mesh(cartonGeo, cartonMat);
    carton.position.y = 0.22;
    carton.castShadow = true;
    carton.receiveShadow = true;
    group.add(carton);

    // Slanted Top / Gable
    const topGeo = new THREE.ConeGeometry(0.20, 0.12, 4);
    const topMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.2, roughness: 0.3 });
    const topPart = new THREE.Mesh(topGeo, topMat);
    topPart.rotation.y = Math.PI / 4;
    topPart.position.y = 0.50;
    group.add(topPart);

    // Plastic Twist Cap
    const capGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.04, 16);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(0.06, 0.53, 0);
    group.add(cap);

  } else if (category.includes('paneer') || category.includes('cheese') || category.includes('tofu')) {
    // Sealed Vacuum Block (Cream / Ivory)
    const blockGeo = new THREE.BoxGeometry(0.34, 0.18, 0.34);
    const blockMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      roughness: 0.4,
      metalness: 0.05
    });
    const block = new THREE.Mesh(blockGeo, blockMat);
    block.position.y = 0.09;
    block.castShadow = true;
    block.receiveShadow = true;
    group.add(block);

    // Transparent Vacuum Film Wrap
    const filmGeo = new THREE.BoxGeometry(0.36, 0.19, 0.36);
    const filmMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.25,
      roughness: 0.1
    });
    const film = new THREE.Mesh(filmGeo, filmMat);
    film.position.y = 0.09;
    group.add(film);

  } else if (category.includes('yogurt') || category.includes('cream')) {
    // Tapered Yogurt Tub with Foil Lid
    const tubGeo = new THREE.CylinderGeometry(0.14, 0.10, 0.26, 24);
    const tubMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.3,
      metalness: 0.1
    });
    const tub = new THREE.Mesh(tubGeo, tubMat);
    tub.position.y = 0.13;
    tub.castShadow = true;
    tub.receiveShadow = true;
    group.add(tub);

    // Silver Foil Lid
    const lidGeo = new THREE.CylinderGeometry(0.145, 0.145, 0.015, 24);
    const lidMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.95,
      roughness: 0.1
    });
    const lid = new THREE.Mesh(lidGeo, lidMat);
    lid.position.y = 0.265;
    group.add(lid);

  } else if (category.includes('vegetable') || category.includes('fruit') || category.includes('produce')) {
    // Produce Storage Crate with Organic Produce Inside
    const crateGeo = new THREE.BoxGeometry(0.44, 0.14, 0.34);
    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x15803d,
      roughness: 0.5,
      metalness: 0.1
    });
    const crate = new THREE.Mesh(crateGeo, crateMat);
    crate.position.y = 0.07;
    crate.castShadow = true;
    crate.receiveShadow = true;
    group.add(crate);

    // Produce Items (Fresh Spheres inside)
    const itemMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.3 });
    const posOffsets = [
      [-0.10, 0.14, -0.06],
      [0.10, 0.14, -0.06],
      [-0.10, 0.14, 0.06],
      [0.10, 0.14, 0.06]
    ];
    posOffsets.forEach(([px, py, pz]) => {
      const apple = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 12), itemMat);
      apple.position.set(px, py, pz);
      group.add(apple);
    });

  } else if (category.includes('meat') || category.includes('fish') || category.includes('seafood')) {
    // Refrigerated Sealed Deli Pack
    const trayGeo = new THREE.BoxGeometry(0.46, 0.10, 0.32);
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });
    const deliTray = new THREE.Mesh(trayGeo, trayMat);
    deliTray.position.y = 0.05;
    deliTray.castShadow = true;
    group.add(deliTray);

    // Meat Block inside
    const meatGeo = new THREE.BoxGeometry(0.40, 0.08, 0.26);
    const meatMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.5 });
    const meat = new THREE.Mesh(meatGeo, meatMat);
    meat.position.y = 0.08;
    group.add(meat);

    // Transparent Cling Wrap Film
    const wrapGeo = new THREE.BoxGeometry(0.46, 0.02, 0.32);
    const wrapMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      roughness: 0.1
    });
    const wrap = new THREE.Mesh(wrapGeo, wrapMat);
    wrap.position.y = 0.12;
    group.add(wrap);

  } else if (category.includes('juice') || category.includes('beverage') || category.includes('bottle')) {
    // Glass Juice / Beverage Bottle
    const bottleBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.34, 20),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.2 })
    );
    bottleBody.position.y = 0.17;
    bottleBody.castShadow = true;
    group.add(bottleBody);

    // Bottle Neck
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.08, 0.10, 16),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.85, roughness: 0.15 })
    );
    neck.position.y = 0.38;
    group.add(neck);

    // Bottle Cap
    const bottleCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.9 })
    );
    bottleCap.position.y = 0.44;
    group.add(bottleCap);

  } else {
    // General Food Storage Container
    const boxGeo = new THREE.BoxGeometry(0.40, 0.22, 0.30);
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.3,
      metalness: 0.1
    });
    const box = new THREE.Mesh(boxGeo, boxMat);
    box.position.y = 0.11;
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);

    // Container Lid
    const lidGeo = new THREE.BoxGeometry(0.42, 0.03, 0.32);
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x0369a1, roughness: 0.3 });
    const lid = new THREE.Mesh(lidGeo, lidMat);
    lid.position.y = 0.23;
    group.add(lid);
  }

  return group;
}

function setupThreeInteraction(viewport, renderer, camera) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let isDragging = false;
  let downPos = { x: 0, y: 0 };

  viewport.addEventListener('pointerdown', (e) => {
    isDragging = false;
    downPos = { x: e.clientX, y: e.clientY };
  });

  viewport.addEventListener('pointermove', (e) => {
    const dx = Math.abs(e.clientX - downPos.x);
    const dy = Math.abs(e.clientY - downPos.y);
    if (dx > 4 || dy > 4) {
      isDragging = true;
    }

    const rect = viewport.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(threeState.interactiveMeshes, true);

    if (intersects.length > 0) {
      let target = intersects[0].object;
      while (target && target.parent && !target.userData?.productId && target !== threeState.scene) {
        target = target.parent;
      }

      if (target && target.userData && target.userData.productId) {
        viewport.style.cursor = 'pointer';
        return;
      }
    }

    viewport.style.cursor = 'grab';
  });

  viewport.addEventListener('pointerup', (e) => {
    if (isDragging) return;

    const rect = viewport.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(threeState.interactiveMeshes, true);

    if (intersects.length > 0) {
      let target = intersects[0].object;
      while (target && target.parent && !target.userData?.productId && target !== threeState.scene) {
        target = target.parent;
      }

      if (target && target.userData && target.userData.productId) {
        openProductViewModal(target.userData.productId);
      }
    }
  });
}

function handleThreeResize() {
  if (!threeState.renderer || !threeState.camera || !dom.threejsViewport) return;
  const viewport = dom.threejsViewport;
  const width = viewport.clientWidth;
  const height = viewport.clientHeight || 520;
  if (width === 0 || height === 0) return;

  threeState.camera.aspect = width / height;
  threeState.camera.updateProjectionMatrix();
  threeState.renderer.setSize(width, height);
}

function startThreeAnimationLoop() {
  const tempVec = new THREE.Vector3();

  function animate(time) {
    threeState.animFrameId = requestAnimationFrame(animate);

    // Update Controls
    if (threeState.controls) {
      threeState.controls.update();
    }

    // Rotate Evaporator Fan Blades
    if (threeState.evaporatorFan) {
      threeState.evaporatorFan.rotation.z += 0.035;
    }

    // Halo Breathing Animation
    threeState.halos.forEach((h, i) => {
      const pulse = Math.sin(time * 0.003 + i) * 0.15 + 0.85;
      h.mesh.material.opacity = (h.isCritical ? 0.95 : 0.75) * pulse;
      if (h.isCritical) {
        const s = 1 + (pulse - 0.85) * 0.20;
        h.mesh.scale.set(s, s, 1);
      }
    });

    // Project 3D Coordinates to 2D Screen Space for Product Tags
    const viewport = dom.threejsViewport;
    if (viewport && threeState.camera && dom.threejsLabelsLayer) {
      const w = viewport.clientWidth;
      const h = viewport.clientHeight;
      const halfW = w / 2;
      const halfH = h / 2;

      threeState.productAnchors.forEach(({ mesh, tagEl }) => {
        if (!tagEl || !mesh) return;
        tempVec.setFromMatrixPosition(mesh.matrixWorld);
        tempVec.y += 0.42; // Position tag directly above item
        tempVec.project(threeState.camera);

        if (tempVec.z > 1.0) {
          tagEl.style.display = 'none';
        } else {
          tagEl.style.display = 'flex';
          const sx = (tempVec.x * halfW) + halfW;
          const sy = -(tempVec.y * halfH) + halfH;
          tagEl.style.left = `${sx.toFixed(1)}px`;
          tagEl.style.top = `${sy.toFixed(1)}px`;
        }
      });

      // Project Shelf Node Tag Anchor
      if (threeState.shelfNodeAnchor && dom.floatingShelfNode) {
        tempVec.setFromMatrixPosition(threeState.shelfNodeAnchor.matrixWorld);
        tempVec.project(threeState.camera);

        if (tempVec.z > 1.0) {
          dom.floatingShelfNode.style.display = 'none';
        } else {
          dom.floatingShelfNode.style.display = 'block';
          const nx = (tempVec.x * halfW) + halfW + 16;
          const ny = -(tempVec.y * halfH) + halfH - 30;
          const clampedX = Math.max(12, Math.min(w - 180, nx));
          const clampedY = Math.max(12, Math.min(h - 150, ny));
          dom.floatingShelfNode.style.left = `${clampedX.toFixed(1)}px`;
          dom.floatingShelfNode.style.top = `${clampedY.toFixed(1)}px`;
          dom.floatingShelfNode.style.right = 'auto';
        }
      }
    }

    if (threeState.renderer && threeState.scene && threeState.camera) {
      threeState.renderer.render(threeState.scene, threeState.camera);
    }
  }

  animate(performance.now());
}

// ==========================================
// 10. DIGITAL TWIN REFRIGERATOR TRAY (2D GRID VIEW)
// ==========================================
function renderDigitalTwinTray() {
  if (!dom.twinTraySurface) return;

  if (productsList.length === 0) {
    dom.twinTraySurface.innerHTML = `
      <div class="tray-loading-placeholder">
        <p>No food products currently registered on the tray.</p>
        <button class="btn btn-primary btn-sm" id="btn-twin-add-prod" style="margin-top: 10px;">+ Add Food Product</button>
      </div>
    `;
    const addBtn = document.getElementById('btn-twin-add-prod');
    if (addBtn) addBtn.addEventListener('click', () => openProductModal());
    return;
  }

  const currentTemp = currentTelemetry.refrigeratorTemperature !== null ? Number(currentTelemetry.refrigeratorTemperature) : 4.0;

  let html = '';
  productsList.forEach((prod) => {
    const risk = evaluateProductRisk(prod, currentTemp);
    const badgeClass = getRiskBadgeClass(risk.classification);

    html += `
      <div class="twin-product-card" data-product-id="${prod.id}" title="Click to view ${escapeHtml(prod.name)} details">
        <div class="twin-product-top">
          <span class="twin-product-category">${escapeHtml(prod.category || 'General')}</span>
          <span class="twin-product-badge ${badgeClass}">${risk.classification}</span>
        </div>
        <div class="twin-product-name">${escapeHtml(prod.name)}</div>
        <div class="twin-product-meta">
          <span class="twin-weight-pill">${Number(prod.weightKg || 0).toFixed(2)} KG</span>
          <span class="twin-expiry-pill">${formatExpiryCountdown(prod.expiryDate)}</span>
        </div>
      </div>
    `;
  });

  dom.twinTraySurface.innerHTML = html;

  // Add click listeners to product cards
  dom.twinTraySurface.querySelectorAll('.twin-product-card').forEach((card) => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-product-id');
      if (id) openProductViewModal(id);
    });
  });
}

function getRiskBadgeClass(classification) {
  switch (classification) {
    case 'REMOVE': return 'badge-remove';
    case 'SELL FIRST': return 'badge-sell-first';
    case 'INSPECT': return 'badge-inspect';
    case 'SAFE': default: return 'badge-safe';
  }
}

// ==========================================
// 10. RULE-BASED FOOD RISK ANALYSIS ENGINE
// ==========================================
/**
 * Strict Priority Order: REMOVE > SELL FIRST > INSPECT > SAFE
 * Evaluates:
 * 1. Product expiry date
 * 2. Current refrigerator temperature
 * 3. Configurable storage thresholds
 */
function evaluateProductRisk(product, currentTemp) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const expDate = new Date(product.expiryDate);
  expDate.setHours(0, 0, 0, 0);

  // Difference in calendar days
  const diffTime = expDate - now;
  const daysToExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  const criticalTempThreshold = thresholds.tempRiskRemove || 9.0;
  const warningTempThreshold = thresholds.tempWarning || 5.0;

  // RULE 1: REMOVE (Highest Priority)
  // Condition: Expiry date is in the past OR Refrigerator temp reaches 9°C or higher
  if (daysToExpiry < 0 || (currentTemp !== null && currentTemp >= criticalTempThreshold)) {
    let reason = 'Expiry date passed or critical storage temperature detected.';
    let ruleName = daysToExpiry < 0 ? 'Rule 1: Expiry Date Passed' : `Rule 1: Critical Temperature (${currentTemp.toFixed(1)}°C \u2265 ${criticalTempThreshold}°C)`;
    let recommendation = daysToExpiry < 0 ? 'Product is expired. Discard item to prevent contamination.' : 'Critical storage temperature detected. Spoilage risk imminent. Remove or verify.';

    return {
      classification: 'REMOVE',
      priority: 1,
      rule: ruleName,
      reason,
      recommendation,
      daysToExpiry
    };
  }

  // RULE 2: SELL FIRST (High Priority)
  // Condition: Expiry is today OR within the next 2 calendar days
  if (daysToExpiry <= 2) {
    return {
      classification: 'SELL FIRST',
      priority: 2,
      rule: 'Rule 2: Expiry Imminent (\u2264 2 Days)',
      reason: 'Expiry is approaching.',
      recommendation: daysToExpiry === 0 ? 'Expires today! Prioritize immediate consumption or sale.' : `Expires in ${daysToExpiry} day(s). Prioritize for use or discount.`,
      daysToExpiry
    };
  }

  // RULE 3: INSPECT (Moderate Priority)
  // Condition: Temp is above 5°C but below 9°C OR Expiry within next 4 calendar days
  if ((currentTemp !== null && currentTemp > warningTempThreshold && currentTemp < criticalTempThreshold) || daysToExpiry <= 4) {
    let reason = 'Temperature requires review or expiry is approaching.';
    let ruleName = (currentTemp !== null && currentTemp > warningTempThreshold) ? `Rule 3: Elevated Temperature (${currentTemp.toFixed(1)}°C)` : 'Rule 3: Approaching Expiry (\u2264 4 Days)';
    let recommendation = 'Inspect packaging seal and cooling condition. Plan for consumption within 4 days.';

    return {
      classification: 'INSPECT',
      priority: 3,
      rule: ruleName,
      reason,
      recommendation,
      daysToExpiry
    };
  }

  // RULE 4: SAFE (Default)
  // Condition: Temp is at or below 5°C AND Expiry is > 4 calendar days away
  return {
    classification: 'SAFE',
    priority: 4,
    rule: 'Rule 4: Standard Chilled Storage',
    reason: 'No configured threshold crossed.',
    recommendation: 'Cold chain intact. Product longevity is well preserved.',
    daysToExpiry
  };
}

function renderRiskAnalysisModule() {
  if (!dom.riskTableBody) return;

  const currentTemp = currentTelemetry.refrigeratorTemperature !== null ? Number(currentTelemetry.refrigeratorTemperature) : 4.0;
  dom.riskCurrentTempBadge.textContent = currentTelemetry.refrigeratorTemperature !== null ? `${currentTemp.toFixed(2)} °C` : '4.00 °C (Nominal Reference)';

  let countSafe = 0;
  let countInspect = 0;
  let countSellFirst = 0;
  let countRemove = 0;

  let rowsHtml = '';

  productsList.forEach((prod) => {
    const risk = evaluateProductRisk(prod, currentTemp);

    if (risk.classification === 'SAFE') countSafe++;
    else if (risk.classification === 'INSPECT') countInspect++;
    else if (risk.classification === 'SELL FIRST') countSellFirst++;
    else if (risk.classification === 'REMOVE') countRemove++;

    const badgeClass = getRiskBadgeClass(risk.classification);

    let daysText = '';
    if (risk.daysToExpiry < 0) {
      daysText = `<span style="color: var(--status-critical); font-weight: 700;">Expired (${Math.abs(risk.daysToExpiry)}d ago)</span>`;
    } else if (risk.daysToExpiry === 0) {
      daysText = `<span style="color: var(--status-sell-first); font-weight: 700;">Expires Today</span>`;
    } else {
      daysText = `${risk.daysToExpiry} day(s)`;
    }

    rowsHtml += `
      <tr>
        <td>
          <div class="table-product-title">${escapeHtml(prod.name)}</div>
          <div class="table-product-cat">${Number(prod.quantity || 1)} ${escapeHtml(prod.unit || 'units')} • ${Number(prod.weightKg || 0).toFixed(2)} KG</div>
        </td>
        <td><span class="twin-product-category">${escapeHtml(prod.category || 'General')}</span></td>
        <td>${escapeHtml(prod.expiryDate)}</td>
        <td>${daysText}</td>
        <td>${Number(prod.storageTemperature || 4.0).toFixed(1)} °C</td>
        <td><span class="twin-product-badge ${badgeClass}">${risk.classification}</span></td>
        <td><code style="font-size: 0.75rem;">${escapeHtml(risk.rule)}</code></td>
        <td>
          <div style="font-size: 0.8rem; color: #ffffff;">${escapeHtml(risk.reason)}</div>
          <div style="font-size: 0.725rem; color: var(--text-muted);">${escapeHtml(risk.recommendation)}</div>
        </td>
      </tr>
    `;
  });

  dom.riskTableBody.innerHTML = rowsHtml || `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">No products currently registered in the inventory.</td></tr>`;

  // Update Summary Counts
  dom.riskCountSafe.textContent = countSafe;
  dom.riskCountInspect.textContent = countInspect;
  dom.riskCountSellFirst.textContent = countSellFirst;
  dom.riskCountRemove.textContent = countRemove;

  // Sidebar Pill
  if (countRemove > 0) {
    dom.navRiskSummaryPill.textContent = `${countRemove} REMOVE`;
    dom.navRiskSummaryPill.className = 'nav-risk-pill badge-remove';
  } else if (countSellFirst > 0) {
    dom.navRiskSummaryPill.textContent = `${countSellFirst} SELL`;
    dom.navRiskSummaryPill.className = 'nav-risk-pill badge-sell-first';
  } else if (countInspect > 0) {
    dom.navRiskSummaryPill.textContent = `${countInspect} INSPECT`;
    dom.navRiskSummaryPill.className = 'nav-risk-pill badge-inspect';
  } else {
    dom.navRiskSummaryPill.textContent = 'ALL SAFE';
    dom.navRiskSummaryPill.className = 'nav-risk-pill badge-safe';
  }
}

function formatExpiryCountdown(expiryDateStr) {
  if (!expiryDateStr) return 'No expiry date';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDateStr);
  exp.setHours(0, 0, 0, 0);

  const diffDays = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `Expired ${Math.abs(diffDays)}d ago`;
  if (diffDays === 0) return 'Expires Today';
  return `${diffDays} days left`;
}

// ==========================================
// 11. PRODUCTS / INVENTORY MODULE
// ==========================================
function renderProductsTable() {
  if (!dom.productsTableBody) return;

  const searchQuery = (dom.inputSearchProduct.value || '').trim().toLowerCase();
  const categoryFilter = dom.filterCategory.value;
  const expiryFilter = dom.filterExpiry.value;
  const riskFilter = dom.filterRisk.value;

  const currentTemp = currentTelemetry.refrigeratorTemperature !== null ? Number(currentTelemetry.refrigeratorTemperature) : 4.0;
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const filtered = productsList.filter((prod) => {
    // Name / Description Search
    if (searchQuery) {
      const matchName = (prod.name || '').toLowerCase().includes(searchQuery);
      const matchDesc = (prod.description || '').toLowerCase().includes(searchQuery);
      if (!matchName && !matchDesc) return false;
    }

    // Category Filter
    if (categoryFilter !== 'ALL' && prod.category !== categoryFilter) {
      return false;
    }

    // Risk Classification Filter
    const risk = evaluateProductRisk(prod, currentTemp);
    if (riskFilter !== 'ALL' && risk.classification !== riskFilter) {
      return false;
    }

    // Expiry Filter
    if (expiryFilter !== 'ALL') {
      const days = risk.daysToExpiry;
      if (expiryFilter === 'EXPIRED' && days >= 0) return false;
      if (expiryFilter === 'TODAY' && days !== 0) return false;
      if (expiryFilter === 'SOON_2' && (days < 0 || days > 2)) return false;
      if (expiryFilter === 'SOON_4' && (days < 0 || days > 4)) return false;
      if (expiryFilter === 'SAFE' && days <= 4) return false;
    }

    return true;
  });

  if (filtered.length === 0) {
    dom.productsTableBody.innerHTML = '';
    dom.productsEmptyState.classList.remove('hidden');
    return;
  }

  dom.productsEmptyState.classList.add('hidden');

  let rowsHtml = '';
  filtered.forEach((prod) => {
    const risk = evaluateProductRisk(prod, currentTemp);
    const badgeClass = getRiskBadgeClass(risk.classification);

    rowsHtml += `
      <tr>
        <td>
          <div class="table-product-title">${escapeHtml(prod.name)}</div>
          <div class="table-product-cat">${escapeHtml(prod.description || 'No description provided')}</div>
        </td>
        <td><span class="twin-product-category">${escapeHtml(prod.category || 'General')}</span></td>
        <td><strong>${Number(prod.quantity || 1)}</strong> ${escapeHtml(prod.unit || 'units')}</td>
        <td><span class="twin-weight-pill">${Number(prod.weightKg || 0).toFixed(2)} KG</span></td>
        <td>${Number(prod.storageTemperature || 4.0).toFixed(1)} °C</td>
        <td>${escapeHtml(prod.storageDate || '--')}</td>
        <td>
          <div>${escapeHtml(prod.expiryDate || '--')}</div>
          <div style="font-size: 0.725rem; color: var(--text-muted);">${formatExpiryCountdown(prod.expiryDate)}</div>
        </td>
        <td><span class="twin-product-badge ${badgeClass}">${risk.classification}</span></td>
        <td class="text-right">
          <div class="table-actions-cell">
            <button class="action-btn" data-action="view" data-id="${prod.id}" title="View Details">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-sm"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>
            <button class="action-btn" data-action="edit" data-id="${prod.id}" title="Edit Product">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-sm"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="action-btn btn-delete" data-action="delete" data-id="${prod.id}" title="Delete Product">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon-sm"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  });

  dom.productsTableBody.innerHTML = rowsHtml;

  // Add click listeners to action buttons
  dom.productsTableBody.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      if (action === 'view') openProductViewModal(id);
      else if (action === 'edit') openProductModal(id);
      else if (action === 'delete') handleDeleteProduct(id);
    });
  });
}

function openProductModal(productId = null) {
  editingProductId = productId;

  if (productId) {
    const prod = productsList.find((p) => p.id === productId);
    if (!prod) return;
    dom.productModalTitle.textContent = 'Edit Food Product';
    dom.inputProductId.value = prod.id;
    dom.inputProductName.value = prod.name || '';
    dom.inputProductCategory.value = prod.category || '';
    dom.inputProductQuantity.value = prod.quantity || 1;
    dom.inputProductUnit.value = prod.unit || '';
    dom.inputProductWeight.value = prod.weightKg || 0.5;
    dom.inputProductTemp.value = prod.storageTemperature || 4.0;
    dom.inputProductStorageDate.value = prod.storageDate || '';
    dom.inputProductExpiryDate.value = prod.expiryDate || '';
    dom.inputProductDescription.value = prod.description || '';
  } else {
    dom.productModalTitle.textContent = 'Register Food Product';
    dom.productForm.reset();
    dom.inputProductId.value = '';
    dom.inputProductQuantity.value = 1;
    dom.inputProductWeight.value = 0.50;
    dom.inputProductTemp.value = 4.0;
    dom.inputProductStorageDate.value = new Date().toISOString().split('T')[0];
    const exp = new Date();
    exp.setDate(exp.getDate() + 5);
    dom.inputProductExpiryDate.value = exp.toISOString().split('T')[0];
  }

  dom.productModal.classList.remove('hidden');
}

function closeProductModal() {
  dom.productModal.classList.add('hidden');
  editingProductId = null;
}

async function handleProductFormSubmit(e) {
  e.preventDefault();

  const productData = {
    name: dom.inputProductName.value.trim(),
    category: dom.inputProductCategory.value,
    quantity: parseInt(dom.inputProductQuantity.value, 10) || 1,
    unit: dom.inputProductUnit.value.trim(),
    weightKg: parseFloat(dom.inputProductWeight.value) || 0.5,
    storageTemperature: parseFloat(dom.inputProductTemp.value) || 4.0,
    storageDate: dom.inputProductStorageDate.value,
    expiryDate: dom.inputProductExpiryDate.value,
    description: dom.inputProductDescription.value.trim(),
    imageUrl: '',
    riskStatus: 'SAFE'
  };

  const currentTemp = currentTelemetry.refrigeratorTemperature !== null ? Number(currentTelemetry.refrigeratorTemperature) : 4.0;
  const evaluatedRisk = evaluateProductRisk(productData, currentTemp);
  productData.riskStatus = evaluatedRisk.classification;

  if (editingProductId) {
    await updateProduct(editingProductId, productData);
    logTerminal('SYSTEM', `Product updated: ${productData.name}`, 'terminal-system');
  } else {
    await addProduct(productData);
    logTerminal('SYSTEM', `New product registered: ${productData.name}`, 'terminal-system');
  }

  closeProductModal();
}

async function handleDeleteProduct(id) {
  const prod = productsList.find((p) => p.id === id);
  const name = prod ? prod.name : 'this item';

  if (confirm(`Are you sure you want to remove "${name}" from the tray inventory?`)) {
    await deleteProduct(id);
    logTerminal('SYSTEM', `Product removed: ${name}`, 'terminal-warning');
  }
}

function openProductViewModal(productId) {
  const prod = productsList.find((p) => p.id === productId);
  if (!prod) return;

  const currentTemp = currentTelemetry.refrigeratorTemperature !== null ? Number(currentTelemetry.refrigeratorTemperature) : 4.0;
  const risk = evaluateProductRisk(prod, currentTemp);
  const badgeClass = getRiskBadgeClass(risk.classification);

  dom.productViewContent.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
      <h4 style="font-size: 1.25rem; font-weight: 700; color: #ffffff;">${escapeHtml(prod.name)}</h4>
      <span class="twin-product-badge ${badgeClass}">${risk.classification}</span>
    </div>
    <div class="view-detail-row">
      <span class="view-detail-label">Category:</span>
      <span class="view-detail-val">${escapeHtml(prod.category || 'General')}</span>
    </div>
    <div class="view-detail-row">
      <span class="view-detail-label">Quantity & Unit:</span>
      <span class="view-detail-val">${Number(prod.quantity || 1)} ${escapeHtml(prod.unit || 'units')}</span>
    </div>
    <div class="view-detail-row">
      <span class="view-detail-label">Item Weight:</span>
      <span class="view-detail-val">${Number(prod.weightKg || 0).toFixed(2)} KG</span>
    </div>
    <div class="view-detail-row">
      <span class="view-detail-label">Target Storage Temp:</span>
      <span class="view-detail-val">${Number(prod.storageTemperature || 4.0).toFixed(1)} °C</span>
    </div>
    <div class="view-detail-row">
      <span class="view-detail-label">Date Stored:</span>
      <span class="view-detail-val">${escapeHtml(prod.storageDate || '--')}</span>
    </div>
    <div class="view-detail-row">
      <span class="view-detail-label">Expiration Date:</span>
      <span class="view-detail-val">${escapeHtml(prod.expiryDate || '--')} (${formatExpiryCountdown(prod.expiryDate)})</span>
    </div>
    <div class="view-detail-row">
      <span class="view-detail-label">Triggered Rule:</span>
      <span class="view-detail-val" style="color: var(--accent-cyan); font-family: 'JetBrains Mono', monospace;">${escapeHtml(risk.rule)}</span>
    </div>
    <div class="view-detail-row">
      <span class="view-detail-label">Preservation Assessment:</span>
      <span class="view-detail-val">${escapeHtml(risk.reason)}</span>
    </div>
    <div style="margin-top: 14px; font-size: 0.8rem; color: var(--text-secondary); background: var(--bg-card-subtle); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
      <strong>Recommendation:</strong> ${escapeHtml(risk.recommendation)}
    </div>
  `;

  dom.btnViewEdit.setAttribute('data-product-id', prod.id);
  dom.productViewModal.classList.remove('hidden');
}

function closeProductViewModal() {
  dom.productViewModal.classList.add('hidden');
}

// ==========================================
// 12. CLOUD SNAPSHOT SCHEDULER & HISTORY
// ==========================================
function startSnapshotScheduler() {
  if (snapshotTimer) clearInterval(snapshotTimer);

  const intervalMs = (thresholds.snapshotIntervalSec || 10) * 1000;
  snapshotTimer = setInterval(() => {
    if (isHardwareConnected || isDemoMode) {
      triggerImmediateCloudSnapshot('PERIODIC');
    }
  }, intervalMs);
}

async function triggerImmediateCloudSnapshot(reason = 'PERIODIC') {
  if (currentTelemetry.refrigeratorTemperature === null && !isDemoMode) {
    return; // Don't save disconnected null telemetry
  }

  const snapshot = {
    deviceId: thresholds.deviceId || 'TRAYVANTA_ESP32_01',
    environmentTemperature: currentTelemetry.environmentTemperature,
    environmentHumidity: currentTelemetry.environmentHumidity,
    refrigeratorTemperature: currentTelemetry.refrigeratorTemperature,
    mq135Raw: currentTelemetry.mq135Raw,
    mq135Voltage: currentTelemetry.mq135Voltage,
    trayWeightKg: currentTelemetry.trayWeightKg,
    warningStatus: currentTelemetry.warningStatus || 'NORMAL',
    source: currentTelemetry.dataSource || 'LIVE'
  };

  await saveSensorReading(snapshot);

  if (activePage === 'history') {
    loadHistoricalRecordsView();
  }
}

async function loadHistoricalRecordsView(limitCount = 100) {
  const sourceFilter = dom.filterHistorySource.value;
  const records = await getHistoricalReadings(limitCount, sourceFilter);
  historyBuffer = records || [];
  renderHistoryTable();
}

function renderHistoryTable() {
  if (!dom.historyTableBody) return;

  const searchQuery = (dom.inputSearchHistory.value || '').trim().toLowerCase();
  const sourceFilter = dom.filterHistorySource.value;
  const warningFilter = dom.filterHistoryWarning.value;

  const filtered = historyBuffer.filter((rec) => {
    if (sourceFilter !== 'ALL' && rec.source !== sourceFilter) return false;
    if (warningFilter !== 'ALL' && rec.warningStatus !== warningFilter) return false;
    if (searchQuery) {
      const ts = (rec.timestamp || '').toLowerCase();
      const dev = (rec.deviceId || '').toLowerCase();
      const stat = (rec.warningStatus || '').toLowerCase();
      if (!ts.includes(searchQuery) && !dev.includes(searchQuery) && !stat.includes(searchQuery)) return false;
    }
    return true;
  });

  // Update Summary Cards
  dom.histTotalSamples.textContent = historyBuffer.length;
  if (historyBuffer.length > 0) {
    const latest = historyBuffer[0];
    const d = new Date(latest.timestamp);
    dom.histLatestTimestamp.textContent = d.toLocaleTimeString();
    dom.histLatestDate.textContent = d.toLocaleDateString();
  } else {
    dom.histLatestTimestamp.textContent = '--:--:--';
    dom.histLatestDate.textContent = 'No records yet';
  }

  const warnings = historyBuffer.filter((r) => r.warningStatus === 'WARNING' || r.warningStatus === 'CRITICAL').length;
  dom.histWarningsCount.textContent = warnings;

  if (filtered.length === 0) {
    dom.historyTableBody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">No sensor snapshots match the filter.</td></tr>`;
    dom.historyShowingLabel.textContent = 'Showing 0 records';
    return;
  }

  dom.historyShowingLabel.textContent = `Showing latest ${filtered.length} records`;

  let rowsHtml = '';
  filtered.forEach((rec) => {
    const d = new Date(rec.timestamp);
    const timeStr = `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    const badgeClass = rec.warningStatus === 'CRITICAL' ? 'status-chip-critical' : (rec.warningStatus === 'WARNING' ? 'status-chip-warning' : 'status-chip-normal');
    const sourceClass = rec.source === 'LIVE' ? 'badge-safe' : 'badge-sell-first';

    rowsHtml += `
      <tr>
        <td style="font-family: 'JetBrains Mono', monospace; font-size: 0.775rem;">${timeStr}</td>
        <td><code>${escapeHtml(rec.deviceId || 'ESP32')}</code></td>
        <td><strong>${rec.refrigeratorTemperature !== null ? Number(rec.refrigeratorTemperature).toFixed(2) : '--'}</strong> °C</td>
        <td>${rec.environmentHumidity !== null ? Number(rec.environmentHumidity).toFixed(2) : '--'} %</td>
        <td>${rec.mq135Raw || '--'} <span style="color: var(--text-muted); font-size: 0.725rem;">(${Number(rec.mq135Voltage || 0).toFixed(2)}V)</span></td>
        <td><strong style="color: var(--accent-cyan); font-family: 'JetBrains Mono', monospace;">${rec.trayWeightKg !== null ? Number(rec.trayWeightKg).toFixed(2) : '--'}</strong> KG</td>
        <td><span class="status-chip ${badgeClass}">${rec.warningStatus}</span></td>
        <td><span class="twin-product-badge ${sourceClass}">${rec.source}</span></td>
      </tr>
    `;
  });

  dom.historyTableBody.innerHTML = rowsHtml;
}

// ==========================================
// 13. CSV EXPORTER (RFC 4180 Standard)
// ==========================================
async function exportHistoryToCsv() {
  const records = await getHistoricalReadings(500, 'ALL');
  if (!records || records.length === 0) {
    alert('No telemetry records available to export.');
    return;
  }

  const headers = [
    'Timestamp',
    'Device_ID',
    'Data_Source',
    'Refrigerator_Temperature_C',
    'Environment_Temperature_C',
    'Environment_Humidity_Percent',
    'MQ135_Raw_ADC',
    'MQ135_Voltage_V',
    'Tray_Weight_KG',
    'Warning_Status'
  ];

  const rows = [headers.join(',')];

  records.forEach((rec) => {
    const row = [
      `"${rec.timestamp || ''}"`,
      `"${rec.deviceId || ''}"`,
      `"${rec.source || 'LIVE'}"`,
      rec.refrigeratorTemperature !== null ? Number(rec.refrigeratorTemperature).toFixed(2) : '',
      rec.environmentTemperature !== null ? Number(rec.environmentTemperature).toFixed(2) : '',
      rec.environmentHumidity !== null ? Number(rec.environmentHumidity).toFixed(2) : '',
      rec.mq135Raw !== null ? rec.mq135Raw : '',
      rec.mq135Voltage !== null ? Number(rec.mq135Voltage).toFixed(2) : '',
      rec.trayWeightKg !== null ? Number(rec.trayWeightKg).toFixed(2) : '',
      `"${rec.warningStatus || 'NORMAL'}"`
    ];
    rows.push(row.join(','));
  });

  const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\r\n'));
  const link = document.createElement('a');
  link.setAttribute('href', csvContent);
  const nowStr = new Date().toISOString().replace(/[:.]/g, '-');
  link.setAttribute('download', `TRAYVANTA_Sensor_History_${nowStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  logTerminal('SYSTEM', `Exported ${records.length} records to CSV.`, 'terminal-system');
}

// ==========================================
// 14. INTERACTIVE HIGH-DPI CANVAS CHART
// ==========================================
function initCanvasChart() {
  renderTelemetryChart();
}

function setChartMode(mode) {
  chartMode = mode;
  if (mode === 'env') {
    dom.btnChartModeEnv.classList.add('active');
    dom.btnChartModeWeight.classList.remove('active');
    dom.chartSubtitle.textContent = 'Showing Refrigerator Temperature, Humidity & Gas concentration over time';
    dom.chartLegend.innerHTML = `
      <span class="legend-item"><span class="legend-color-box col-temp"></span> Refrigerator Temp (°C)</span>
      <span class="legend-item"><span class="legend-color-box col-hum"></span> Humidity (%)</span>
      <span class="legend-item"><span class="legend-color-box col-gas"></span> Gas ADC (/100)</span>
    `;
  } else {
    dom.btnChartModeEnv.classList.remove('active');
    dom.btnChartModeWeight.classList.add('active');
    dom.chartSubtitle.textContent = 'Showing Total Stored Tray Weight (KG) measured via 5KG Load Cell + HX711';
    dom.chartLegend.innerHTML = `
      <span class="legend-item"><span class="legend-color-box col-weight"></span> Tray Weight (KG)</span>
    `;
  }
  renderTelemetryChart();
}

function recordTelemetryForChart() {
  if (currentTelemetry.refrigeratorTemperature === null && currentTelemetry.trayWeightKg === null) {
    return;
  }

  chartHistoryPoints.push({
    time: Date.now(),
    temp: currentTelemetry.refrigeratorTemperature !== null ? Number(currentTelemetry.refrigeratorTemperature) : 0,
    hum: currentTelemetry.environmentHumidity !== null ? Number(currentTelemetry.environmentHumidity) : 0,
    gas: currentTelemetry.mq135Raw !== null ? Number(currentTelemetry.mq135Raw) / 100 : 0, // scale for chart
    weight: currentTelemetry.trayWeightKg !== null ? Number(currentTelemetry.trayWeightKg) : 0
  });

  // Keep last 300 live points in memory
  if (chartHistoryPoints.length > 300) {
    chartHistoryPoints.shift();
  }

  if (activePage === 'monitoring') {
    renderTelemetryChart();
  }
}

function renderTelemetryChart() {
  const canvas = dom.telemetryCanvas;
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  // Background clear
  ctx.clearRect(0, 0, width, height);

  // Filter points according to range
  const now = Date.now();
  let points = chartHistoryPoints;
  if (chartRangeSeconds > 0) {
    const cutoff = now - chartRangeSeconds * 1000;
    points = chartHistoryPoints.filter((p) => p.time >= cutoff);
  }

  dom.chartSampleCount.textContent = `Samples in view: ${points.length}`;

  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  if (chartW <= 0 || chartH <= 0) return;

  // Grid Lines & Axes
  ctx.strokeStyle = '#1e3052';
  ctx.lineWidth = 1;
  ctx.beginPath();

  // 4 horizontal gridlines
  for (let i = 0; i <= 4; i++) {
    const y = paddingTop + (chartH / 4) * i;
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + chartW, y);
  }
  ctx.stroke();

  // Axis Labels
  ctx.fillStyle = '#64748b';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'right';

  let maxY = chartMode === 'env' ? 100 : 6.0;
  let minY = 0;

  for (let i = 0; i <= 4; i++) {
    const y = paddingTop + (chartH / 4) * i;
    const val = maxY - ((maxY - minY) / 4) * i;
    ctx.fillText(chartMode === 'env' ? `${val.toFixed(0)}` : `${val.toFixed(1)}kg`, paddingLeft - 8, y + 3);
  }

  if (points.length < 2) {
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText('Awaiting real-time data packets to draw line...', paddingLeft + chartW / 2, paddingTop + chartH / 2);
    return;
  }

  // Draw Series
  const startTime = points[0].time;
  const endTime = points[points.length - 1].time;
  const timeSpan = Math.max(1000, endTime - startTime);

  function getX(t) {
    return paddingLeft + ((t - startTime) / timeSpan) * chartW;
  }
  function getY(val) {
    const clamped = Math.max(minY, Math.min(maxY, val));
    return paddingTop + chartH - ((clamped - minY) / (maxY - minY)) * chartH;
  }

  if (chartMode === 'env') {
    // 1. Humidity (Blue)
    drawSeriesLine(ctx, points, (p) => p.hum, '#3b82f6', getX, getY);
    // 2. Gas Scaled (Amber)
    drawSeriesLine(ctx, points, (p) => p.gas, '#f59e0b', getX, getY);
    // 3. Refrigerator Temp (Teal)
    drawSeriesLine(ctx, points, (p) => p.temp, '#06b6d4', getX, getY, true);
  } else {
    // Weight Series (Green)
    drawSeriesLine(ctx, points, (p) => p.weight, '#10b981', getX, getY, true);
  }
}

function drawSeriesLine(ctx, points, valueSelector, color, getX, getY, drawPoints = false) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();

  points.forEach((p, idx) => {
    const x = getX(p.time);
    const y = getY(valueSelector(p));
    if (idx === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  if (drawPoints) {
    ctx.fillStyle = color;
    points.forEach((p) => {
      const x = getX(p.time);
      const y = getY(valueSelector(p));
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

// ==========================================
// 15. DUMMY SIMULATION DEMONSTRATION MODE
// ==========================================
function toggleDemoMode() {
  if (isDemoMode) {
    stopDemoMode();
  } else {
    startDemoMode();
  }
}

function startDemoMode() {
  if (isHardwareConnected) {
    handleDisconnectESP32();
  }

  isDemoMode = true;
  demoTickCount = 0;
  dom.simulationBanner.classList.remove('hidden');
  dom.btnDemoLabel.textContent = 'STOP DEMO';
  dom.btnDemoMode.classList.add('btn-primary');
  setDataSourceMode('SIMULATED');

  logTerminal('SYSTEM', 'STARTING DEMO SIMULATION MODE: Generating gradual illustrative telemetry.', 'terminal-warning');

  // Initial Seed Telemetry
  updateSimulatedTick();

  // Run simulation loop every 1000ms
  if (demoTimer) clearInterval(demoTimer);
  demoTimer = setInterval(updateSimulatedTick, 1000);
}

function stopDemoMode() {
  isDemoMode = false;
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
  dom.simulationBanner.classList.add('hidden');
  dom.btnDemoLabel.textContent = 'START DEMO';
  dom.btnDemoMode.classList.remove('btn-primary');

  logTerminal('SYSTEM', 'Demo Simulation Mode stopped.', 'terminal-system');
  setDataSourceMode('LIVE');
  resetTelemetryState();
}

function resetSimulationValues() {
  demoBaseTemp = 3.6;
  demoBaseHum = 68.0;
  demoBaseGas = 1050;
  demoBaseWeight = 2.85;
  demoTickCount = 0;
  updateSimulatedTick();
  logTerminal('SYSTEM', 'Simulated parameters reset to optimal baseline (3.6°C / 68% / 1050 ADC / 2.85 KG).', 'terminal-system');
}

function triggerSimulatedTemperatureRise() {
  demoBaseTemp = 8.5; // Will cross warning into critical threshold
  logTerminal('SYSTEM', 'Simulating Refrigerator Temperature Rise: Target ~9.2°C to demonstrate Inspect & Remove alerts.', 'terminal-warning');
}

function updateSimulatedTick() {
  demoTickCount++;

  // Gentle sine oscillation + minute noise (gradual, no sudden jumps)
  const tempWave = Math.sin(demoTickCount * 0.15) * 0.25;
  const humWave = Math.cos(demoTickCount * 0.1) * 0.8;
  const gasWave = Math.sin(demoTickCount * 0.2) * 25;

  let currentSimTemp = demoBaseTemp + tempWave;
  // If simulated temp rise was triggered, drift upward gradually
  if (demoBaseTemp > 7.0 && currentSimTemp < 9.6) {
    demoBaseTemp += 0.15;
  }

  const currentSimHum = Math.min(95, Math.max(30, demoBaseHum + humWave));
  const currentSimGas = Math.round(demoBaseGas + gasWave);
  const currentSimVolt = (currentSimGas * (3.30 / 4095.0));

  // Weight fluctuates very slightly (+/- 0.01kg)
  const currentSimWeight = Number((demoBaseWeight + (Math.sin(demoTickCount * 0.08) * 0.02)).toFixed(2));

  currentTelemetry.refrigeratorTemperature = Number(currentSimTemp.toFixed(2));
  currentTelemetry.environmentHumidity = Number(currentSimHum.toFixed(2));
  currentTelemetry.environmentTemperature = 27.5 + Number((Math.sin(demoTickCount * 0.05) * 0.3).toFixed(2));
  currentTelemetry.mq135Raw = currentSimGas;
  currentTelemetry.mq135Voltage = Number(currentSimVolt.toFixed(2));
  currentTelemetry.trayWeightKg = currentSimWeight;
  currentTelemetry.dataSource = 'SIMULATED';
  currentTelemetry.timestamp = new Date().toISOString();

  packetCount++;
  dom.packetCounter.textContent = `Packets: ${packetCount} (SIM)`;

  evaluateSystemHealthAndAlerts();
  updateAllDashboardVisuals();
  recordTelemetryForChart();

  // Structured Serial Log Output
  logFormattedSerialTelemetry({
    refrigerator_temperature: currentTelemetry.refrigeratorTemperature,
    environment_humidity: currentTelemetry.environmentHumidity,
    environment_temperature: currentTelemetry.environmentTemperature,
    mq135_raw: currentTelemetry.mq135Raw,
    mq135_voltage: currentTelemetry.mq135Voltage,
    weight_kg: currentTelemetry.trayWeightKg,
    status: 'SIMULATED'
  });
}

// ==========================================
// 16. SETTINGS MODAL & THRESHOLDS
// ==========================================
function openSettingsModal() {
  dom.inputTempWarning.value = thresholds.tempWarning;
  dom.inputTempCritical.value = thresholds.tempCritical;
  dom.inputMq135Warning.value = thresholds.mq135Warning;
  dom.inputMq135Critical.value = thresholds.mq135Critical;
  dom.inputSnapshotInterval.value = thresholds.snapshotIntervalSec || 10;
  dom.settingsModal.classList.remove('hidden');
}

function closeSettingsModal() {
  dom.settingsModal.classList.add('hidden');
}

function handleSettingsFormSubmit(e) {
  e.preventDefault();
  thresholds.tempWarning = parseFloat(dom.inputTempWarning.value) || DEFAULT_THRESHOLDS.tempWarning;
  thresholds.tempCritical = parseFloat(dom.inputTempCritical.value) || DEFAULT_THRESHOLDS.tempCritical;
  thresholds.mq135Warning = parseInt(dom.inputMq135Warning.value, 10) || DEFAULT_THRESHOLDS.mq135Warning;
  thresholds.mq135Critical = parseInt(dom.inputMq135Critical.value, 10) || DEFAULT_THRESHOLDS.mq135Critical;
  thresholds.snapshotIntervalSec = parseInt(dom.inputSnapshotInterval.value, 10) || DEFAULT_THRESHOLDS.snapshotIntervalSec;

  saveSettings();
  startSnapshotScheduler();
  closeSettingsModal();
  logTerminal('SYSTEM', 'Configurable thresholds and snapshot interval updated.', 'terminal-system');

  evaluateSystemHealthAndAlerts();
  updateAllDashboardVisuals();
}

function handleResetThresholds() {
  thresholds = { ...DEFAULT_THRESHOLDS };
  dom.inputTempWarning.value = thresholds.tempWarning;
  dom.inputTempCritical.value = thresholds.tempCritical;
  dom.inputMq135Warning.value = thresholds.mq135Warning;
  dom.inputMq135Critical.value = thresholds.mq135Critical;
  dom.inputSnapshotInterval.value = thresholds.snapshotIntervalSec;

  saveSettings();
  startSnapshotScheduler();
  closeSettingsModal();
  logTerminal('SYSTEM', 'Thresholds reset to factory demonstration defaults.', 'terminal-system');

  evaluateSystemHealthAndAlerts();
  updateAllDashboardVisuals();
}

// ==========================================
// 17. FORMATTED SERIAL TELEMETRY LOGGING
// ==========================================
function logFormattedSerialTelemetry(data) {
  const time = getTimestamp();
  let linesHtml = '';

  if (data.environment_temperature !== null && data.environment_humidity !== null) {
    linesHtml += `<div class="terminal-line"><span class="t-time">[${time}]</span> <span class="t-param">Env Temp:</span> <span class="t-val">${Number(data.environment_temperature).toFixed(2)} °C</span> | <span class="t-param">Humidity:</span> <span class="t-val">${Number(data.environment_humidity).toFixed(2)} %</span></div>`;
  }

  if (data.refrigerator_temperature !== null) {
    linesHtml += `<div class="terminal-line"><span class="t-time">[${time}]</span> <span class="t-param">Refrigerator Temp:</span> <span class="t-val">${Number(data.refrigerator_temperature).toFixed(2)} °C</span></div>`;
  }

  if (data.mq135_raw !== null) {
    linesHtml += `<div class="terminal-line"><span class="t-time">[${time}]</span> <span class="t-param">MQ135 Gas:</span> <span class="t-val">${data.mq135_raw}</span> (${Number(data.mq135_voltage || 0).toFixed(2)} V)</div>`;
  }

  if (data.weight_kg !== null) {
    linesHtml += `<div class="terminal-line"><span class="t-time">[${time}]</span> <span class="t-param">Tray Weight:</span> <span class="t-val">${Number(data.weight_kg).toFixed(2)} KG</span></div>`;
  }

  appendTerminalHtml(linesHtml);
}

function logTerminal(prefix, message, typeClass = 'terminal-system') {
  const time = getTimestamp();
  const html = `<div class="terminal-line ${typeClass}"><span class="t-time">[${time}]</span> <span class="t-msg">${escapeHtml(message)}</span></div>`;
  appendTerminalHtml(html);
}

function appendTerminalHtml(html) {
  if (!dom.serialTerminal) return;
  dom.serialTerminal.insertAdjacentHTML('beforeend', html);

  // Keep buffer size limited to 150 items
  while (dom.serialTerminal.children.length > 150) {
    dom.serialTerminal.removeChild(dom.serialTerminal.firstElementChild);
  }

  if (dom.chkAutoscroll && dom.chkAutoscroll.checked) {
    dom.serialTerminal.scrollTop = dom.serialTerminal.scrollHeight;
  }
}

function getTimestamp() {
  const d = new Date();
  return d.toTimeString().split(' ')[0];
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
