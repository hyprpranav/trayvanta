/**
 * TRAYVANTA - Modular Firebase Integration
 * 
 * Provides Cloud Firestore storage, Anonymous Authentication,
 * robust error handling, transient retry management, and seamless
 * local caching fallback if Firebase is not yet configured.
 */

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

// Modular SDK CDNs
const FIREBASE_APP_CDN = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
const FIREBASE_AUTH_CDN = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
const FIREBASE_FIRESTORE_CDN = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

let app = null;
let auth = null;
let db = null;
let currentUser = null;
let isInitialized = false;
let currentStatus = 'STANDBY'; // 'STANDBY' | 'CONNECTING' | 'CONNECTED' | 'ERROR' | 'OFFLINE'
let statusListeners = [];

// Local storage keys for fallback cache
const STORAGE_KEY_PRODUCTS = 'trayvanta_cached_products';
const STORAGE_KEY_HISTORY = 'trayvanta_cached_history';
const STORAGE_KEY_ALERTS = 'trayvanta_cached_alerts';
const STORAGE_KEY_SETTINGS = 'trayvanta_cached_settings';

// Seed default products for demonstration if inventory is empty
const INITIAL_DEMO_PRODUCTS = [
  {
    name: "Fresh Whole Milk",
    category: "Milk",
    quantity: 2,
    unit: "litres",
    weightKg: 2.05,
    storageTemperature: 3.5,
    storageDate: getRelativeDateString(-2),
    expiryDate: getRelativeDateString(5),
    imageUrl: "",
    description: "Pasteurized homogenized dairy milk",
    riskStatus: "SAFE"
  },
  {
    name: "Farm Fresh Paneer",
    category: "Paneer",
    quantity: 1,
    unit: "block",
    weightKg: 0.50,
    storageTemperature: 4.0,
    storageDate: getRelativeDateString(-3),
    expiryDate: getRelativeDateString(1),
    imageUrl: "",
    description: "Soft cottage cheese block",
    riskStatus: "SELL FIRST"
  },
  {
    name: "Greek Yogurt Cup",
    category: "Yogurt",
    quantity: 3,
    unit: "cups",
    weightKg: 0.60,
    storageTemperature: 3.8,
    storageDate: getRelativeDateString(-5),
    expiryDate: getRelativeDateString(3),
    imageUrl: "",
    description: "Probiotic whole milk yogurt",
    riskStatus: "INSPECT"
  },
  {
    name: "Cheddar Cheese Block",
    category: "Cheese",
    quantity: 1,
    unit: "block",
    weightKg: 0.45,
    storageTemperature: 4.2,
    storageDate: getRelativeDateString(-10),
    expiryDate: getRelativeDateString(-1),
    imageUrl: "",
    description: "Sharp matured cheddar",
    riskStatus: "REMOVE"
  }
];

function getRelativeDateString(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

/**
 * Register a listener for Firebase connection status updates.
 */
export function onFirebaseStatusChange(callback) {
  if (typeof callback === 'function') {
    statusListeners.push(callback);
    callback(currentStatus, getStatusMessage(currentStatus));
  }
}

function notifyStatus(status, detail = '') {
  currentStatus = status;
  const message = detail || getStatusMessage(status);
  statusListeners.forEach((cb) => {
    try {
      cb(status, message);
    } catch (e) {
      console.warn('Error in status listener:', e);
    }
  });
}

function getStatusMessage(status) {
  switch (status) {
    case 'CONNECTED':
      return 'Firebase Connected (Firestore Active)';
    case 'CONNECTING':
      return 'Connecting to Firebase...';
    case 'STANDBY':
      return 'Firebase: Standby (Awaiting Config)';
    case 'OFFLINE':
      return 'Firebase: Offline Mode (Local Persistence)';
    case 'ERROR':
      return 'Firebase: Authentication / Permission Error';
    default:
      return 'Firebase: Idle';
  }
}

/**
 * Initialize Firebase Modular SDK with Anonymous Authentication.
 */
export async function initFirebase() {
  if (!isFirebaseConfigured()) {
    notifyStatus('STANDBY', 'Firebase configuration pending. Using local fallback cache.');
    console.info('[TRAYVANTA Firebase] Placeholder credentials detected in firebase-config.js. Operating in local demo mode.');
    seedInitialLocalDataIfEmpty();
    return false;
  }

  notifyStatus('CONNECTING', 'Initializing Firebase Modular SDK...');

  try {
    const { initializeApp } = await import(FIREBASE_APP_CDN);
    const { getAuth, signInAnonymously, onAuthStateChanged } = await import(FIREBASE_AUTH_CDN);
    const { getFirestore } = await import(FIREBASE_FIRESTORE_CDN);

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    // Sign in anonymously for demonstration access
    await signInAnonymously(auth);

    onAuthStateChanged(auth, (user) => {
      if (user) {
        currentUser = user;
        isInitialized = true;
        notifyStatus('CONNECTED', `Authenticated Anonymously (UID: ${user.uid.slice(0, 6)}...)`);
        console.info('[TRAYVANTA Firebase] Connected successfully. UID:', user.uid);
      } else {
        currentUser = null;
        notifyStatus('STANDBY', 'User signed out.');
      }
    });

    return true;
  } catch (error) {
    console.error('[TRAYVANTA Firebase] Initialization failed:', error);
    notifyStatus('ERROR', `Firebase Error: ${error.message || 'Check configuration and security rules.'}`);
    seedInitialLocalDataIfEmpty();
    return false;
  }
}

/**
 * Seed initial mock products into localStorage if none exist.
 */
function seedInitialLocalDataIfEmpty() {
  try {
    const existing = localStorage.getItem(STORAGE_KEY_PRODUCTS);
    if (!existing || JSON.parse(existing).length === 0) {
      const seeded = INITIAL_DEMO_PRODUCTS.map((p, idx) => ({
        ...p,
        id: `local_prod_${Date.now()}_${idx}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }));
      localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(seeded));
    }
  } catch (e) {
    console.warn('Could not seed local data:', e);
  }
}

/**
 * Save a periodic sensor snapshot to Firestore 'sensorReadings' collection.
 * Includes automatic retry on transient network errors.
 */
export async function saveSensorReading(reading) {
  const documentPayload = {
    deviceId: reading.deviceId || 'TRAYVANTA_ESP32_01',
    environmentTemperature: reading.environmentTemperature !== undefined ? reading.environmentTemperature : null,
    environmentHumidity: reading.environmentHumidity !== undefined ? reading.environmentHumidity : null,
    refrigeratorTemperature: reading.refrigeratorTemperature !== undefined ? reading.refrigeratorTemperature : null,
    mq135Raw: reading.mq135Raw !== undefined ? reading.mq135Raw : null,
    mq135Voltage: reading.mq135Voltage !== undefined ? reading.mq135Voltage : null,
    trayWeightKg: reading.trayWeightKg !== undefined ? reading.trayWeightKg : null,
    warningStatus: reading.warningStatus || 'NORMAL',
    source: reading.source || 'LIVE'
  };

  // Always keep an in-memory & localStorage copy for the History table & CSV export
  saveReadingToLocalCache({
    ...documentPayload,
    id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString()
  });

  if (!isInitialized || !db) {
    return false;
  }

  // Attempt write with up to 2 retries
  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const { collection, addDoc, serverTimestamp } = await import(FIREBASE_FIRESTORE_CDN);
      await addDoc(collection(db, 'sensorReadings'), {
        ...documentPayload,
        timestamp: serverTimestamp()
      });
      return true;
    } catch (err) {
      console.warn(`[TRAYVANTA Firebase] Save reading attempt ${attempts} failed:`, err.message);
      if (attempts >= maxAttempts) {
        notifyStatus('OFFLINE', 'Cloud snapshot failed. Telemetry saved locally.');
        return false;
      }
      await new Promise((res) => setTimeout(res, 800));
    }
  }
  return false;
}

function saveReadingToLocalCache(record) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift(record);
    // Keep last 300 records locally
    if (list.length > 300) list.pop();
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(list));
  } catch (e) {
    console.warn('Local history cache error:', e);
  }
}

/**
 * Retrieve historical sensor readings from Firestore or fallback cache.
 */
export async function getHistoricalReadings(limitCount = 100, sourceFilter = 'ALL') {
  if (isInitialized && db) {
    try {
      const { collection, query, orderBy, limit, getDocs, where } = await import(FIREBASE_FIRESTORE_CDN);
      let q;
      if (sourceFilter && sourceFilter !== 'ALL') {
        q = query(
          collection(db, 'sensorReadings'),
          where('source', '==', sourceFilter),
          orderBy('timestamp', 'desc'),
          limit(limitCount)
        );
      } else {
        q = query(
          collection(db, 'sensorReadings'),
          orderBy('timestamp', 'desc'),
          limit(limitCount)
        );
      }
      const snapshot = await getDocs(q);
      const records = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        let tsString = new Date().toISOString();
        if (d.timestamp && typeof d.timestamp.toDate === 'function') {
          tsString = d.timestamp.toDate().toISOString();
        } else if (d.timestamp) {
          tsString = new Date(d.timestamp).toISOString();
        }
        records.push({
          id: docSnap.id,
          ...d,
          timestamp: tsString
        });
      });
      if (records.length > 0) return records;
    } catch (err) {
      console.warn('[TRAYVANTA Firebase] Query historical readings failed, using cache:', err.message);
    }
  }

  // Fallback to local cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    let list = raw ? JSON.parse(raw) : [];
    if (sourceFilter && sourceFilter !== 'ALL') {
      list = list.filter((item) => item.source === sourceFilter);
    }
    return list.slice(0, limitCount);
  } catch (e) {
    return [];
  }
}

/**
 * Subscribe to product updates in real-time.
 */
export async function subscribeProducts(onUpdate) {
  seedInitialLocalDataIfEmpty();

  if (isInitialized && db) {
    try {
      const { collection, onSnapshot, query, orderBy } = await import(FIREBASE_FIRESTORE_CDN);
      const q = query(collection(db, 'products'), orderBy('createdAt', 'desc'));

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const products = [];
        snapshot.forEach((docSnap) => {
          products.push({ id: docSnap.id, ...docSnap.data() });
        });
        if (products.length > 0) {
          localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(products));
          onUpdate(products);
        } else {
          // If Firestore collection is empty, load local fallback
          loadLocalProducts(onUpdate);
        }
      }, (err) => {
        console.warn('[TRAYVANTA Firebase] Product listener error:', err.message);
        loadLocalProducts(onUpdate);
      });

      return unsubscribe;
    } catch (e) {
      console.warn('[TRAYVANTA Firebase] Could not set up snapshot listener:', e);
      loadLocalProducts(onUpdate);
      return () => {};
    }
  } else {
    loadLocalProducts(onUpdate);
    return () => {};
  }
}

function loadLocalProducts(onUpdate) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRODUCTS);
    const products = raw ? JSON.parse(raw) : INITIAL_DEMO_PRODUCTS;
    onUpdate(products);
  } catch (e) {
    onUpdate(INITIAL_DEMO_PRODUCTS);
  }
}

/**
 * Add a new product to inventory.
 */
export async function addProduct(productData) {
  const newProduct = {
    ...productData,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (isInitialized && db) {
    try {
      const { collection, addDoc, serverTimestamp } = await import(FIREBASE_FIRESTORE_CDN);
      const docRef = await addDoc(collection(db, 'products'), {
        ...productData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      return { success: true, id: docRef.id };
    } catch (err) {
      console.warn('[TRAYVANTA Firebase] Cloud addProduct failed, writing locally:', err.message);
    }
  }

  // Local storage write
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRODUCTS);
    const list = raw ? JSON.parse(raw) : [];
    const localId = `prod_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    list.unshift({ ...newProduct, id: localId });
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(list));
    return { success: true, id: localId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Update an existing product.
 */
export async function updateProduct(id, productData) {
  if (isInitialized && db && !id.startsWith('local_') && !id.startsWith('prod_')) {
    try {
      const { doc, updateDoc, serverTimestamp } = await import(FIREBASE_FIRESTORE_CDN);
      const docRef = doc(db, 'products', id);
      await updateDoc(docRef, {
        ...productData,
        updatedAt: serverTimestamp()
      });
      return { success: true };
    } catch (err) {
      console.warn('[TRAYVANTA Firebase] Cloud updateProduct failed, updating locally:', err.message);
    }
  }

  // Local storage update
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRODUCTS);
    let list = raw ? JSON.parse(raw) : [];
    list = list.map((p) => (p.id === id ? { ...p, ...productData, updatedAt: new Date().toISOString() } : p));
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(list));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Delete a product.
 */
export async function deleteProduct(id) {
  if (isInitialized && db && !id.startsWith('local_') && !id.startsWith('prod_')) {
    try {
      const { doc, deleteDoc } = await import(FIREBASE_FIRESTORE_CDN);
      await deleteDoc(doc(db, 'products', id));
      return { success: true };
    } catch (err) {
      console.warn('[TRAYVANTA Firebase] Cloud deleteProduct failed, deleting locally:', err.message);
    }
  }

  // Local storage delete
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PRODUCTS);
    let list = raw ? JSON.parse(raw) : [];
    list = list.filter((p) => p.id !== id);
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(list));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Save an emergency alert to Firestore.
 */
export async function saveAlert(alertData) {
  const payload = {
    deviceId: alertData.deviceId || 'TRAYVANTA_ESP32_01',
    alertType: alertData.alertType || 'GENERAL',
    message: alertData.message || '',
    severity: alertData.severity || 'WARNING',
    reading: alertData.reading !== undefined ? alertData.reading : null,
    source: alertData.source || 'LIVE'
  };

  // Local cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ALERTS);
    const list = raw ? JSON.parse(raw) : [];
    list.unshift({ ...payload, id: `alt_${Date.now()}`, timestamp: new Date().toISOString() });
    if (list.length > 50) list.pop();
    localStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(list));
  } catch (e) {
    console.warn('Local alerts cache error:', e);
  }

  if (isInitialized && db) {
    try {
      const { collection, addDoc, serverTimestamp } = await import(FIREBASE_FIRESTORE_CDN);
      await addDoc(collection(db, 'alerts'), {
        ...payload,
        timestamp: serverTimestamp()
      });
      return true;
    } catch (err) {
      console.warn('[TRAYVANTA Firebase] Alert write failed:', err.message);
      return false;
    }
  }
  return false;
}

/**
 * Save configurable application settings to Firestore.
 */
export async function saveAppSettings(settings) {
  localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));

  if (isInitialized && db) {
    try {
      const { doc, setDoc } = await import(FIREBASE_FIRESTORE_CDN);
      await setDoc(doc(db, 'appSettings', 'global_config'), {
        ...settings,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      return true;
    } catch (err) {
      console.warn('[TRAYVANTA Firebase] Settings write failed:', err.message);
    }
  }
  return false;
}
