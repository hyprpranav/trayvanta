# TRAYVANTA

### Smart Refrigeration Digital Twin & Food Inventory Management System
> **"Smart Monitoring. Better Food Preservation."**

TRAYVANTA is an advanced IoT-based single-tray refrigerator digital twin and inventory management system powered by an ESP32 microcontroller and high-precision sensors. The system combines real-time physical telemetry transmitted over **USB Serial (Web Serial API)** with a cloud-synchronized **Firebase Cloud Firestore** backend, interactive digital twin visualization, deterministic rule-based food spoilage risk analysis, and comprehensive historical export capabilities.

---

## 1. System Architecture & Modules Overview

The updated TRAYVANTA web dashboard features five core modules:

```
                    +------------------------------------------+
                    |             TRAYVANTA SYSTEM             |
                    +------------------------------------------+
                                         |
     +-----------------+-----------------+-----------------+-----------------+
     |                 |                 |                 |                 |
     v                 v                 v                 v                 v
[1. DIGITAL TWIN]  [2. MONITORING]  [3. PRODUCTS]  [4. RISK ANALYSIS] [5. HISTORY & EXPORT]
- Physical Tray    - 4 Sensor Cards - Inventory    - Priority Order   - 10s Cloud Snapshots
- Product Mapping  - Dynamic Chart  - Expiry Track - REMOVE           - Warning Triggers
- Visual Status    - Serial Monitor - CRUD Modals  - SELL FIRST       - Filterable Logs
- Ambient Lighting - Alerts System  - Firestore DB - INSPECT / SAFE   - RFC 4180 CSV
```

1. **Digital Twin Module:** A high-fidelity visual representation of the single physical refrigerator tray with active telemetry overlay, ambient lighting, capacity gauge, and interactive food items.
2. **Monitoring Module:** Real-time multi-sensor telemetry (DS18B20 Refrigerator Temperature, DHT22 Environment Humidity & Temperature, MQ135 Gas/Air Quality, and 5KG Load Cell HX711 Tray Weight), interactive canvas history chart, and live serial terminal.
3. **Products / Inventory Module:** Full product lifecycle management (Name, Category, Quantity, Unit, Weight, Storage Temp, Storage Date, Expiry Date) permanently stored in Firebase Cloud Firestore.
4. **Risk Analysis Module:** Deterministic, rule-based food preservation classification: `REMOVE > SELL FIRST > INSPECT > SAFE`.
5. **History & Export Module:** Periodic sensor snapshots stored in Firestore every 10 seconds or upon warning state transitions, with date/source filtering and direct CSV export.

---

## 2. Hardware Components

| Component | Specification / Purpose |
| :--- | :--- |
| **Microcontroller** | ESP32 Dev Module (NodeMCU / WROOM-32) |
| **Environment Sensor** | DHT22 / AM2302 (Ambient Room Temperature & Relative Humidity) |
| **Tray Temperature Sensor** | DS18B20 Waterproof Stainless Probe (Refrigerator Tray Temperature) |
| **Air Quality / Gas Sensor** | MQ135 (Atmospheric Gas Anomaly / Air Quality Variation) |
| **Weight Sensor** | 5KG Load Cell (Single-tray physical force measurement) |
| **Amplifier** | HX711 24-Bit ADC Weight Sensor Module |
| **Communication Cable** | High-quality Micro-USB / USB-C data cable |
| **Resistors** | 4.7kΩ pull-up resistor for DS18B20; voltage divider (1kΩ / 2kΩ) for MQ135 AO |

---

## 3. ESP32 Hardware Pin Connections

| Sensor / Module Pin | ESP32 GPIO | Electrical Connection Notes |
| :--- | :--- | :--- |
| **DHT22 DATA** | **GPIO 4** | Power: 3.3V & GND. |
| **DS18B20 DATA** | **GPIO 16** | Power: 3.3V & GND. Requires a **4.7kΩ pull-up resistor** between DATA and 3.3V. |
| **MQ135 AO** | **GPIO 34** | Power: 5V (heater) & GND. **Crucial:** GPIO 34 is not 5V-tolerant; use voltage divider (e.g. 1kΩ / 2kΩ) to keep signal ≤ 3.3V. |
| **HX711 DT (DOUT)** | **GPIO 26** | Power: 3.3V & Common GND. Channel A used. |
| **HX711 SCK (CLK)** | **GPIO 27** | Power: 3.3V & Common GND. |

---

## 4. Load Cell to HX711 Wiring

Connect the 4-wire 5KG load cell directly to the HX711 amplifier terminal block:

| Load Cell Wire Color | HX711 Terminal Pin | Function |
| :--- | :--- | :--- |
| **Red** | **E+** | Excitation Positive |
| **Black** | **E-** | Excitation Ground |
| **Green** | **A+** | Channel A Positive Signal |
| **White** | **A-** | Channel A Negative Signal |

*(Note: Terminals B+ and B- are not used for Channel A).*

---

## 5. Load Cell Demonstration Mapping Logic

For this single-tray prototype, the Load Cell uses the accepted demonstration mapping logic implemented directly inside [`ESP32/ESP32.ino`](file:///d:/Project%20Works/trayvanta/ESP32/ESP32.ino):

```cpp
// 1. Startup baseline measurement
long difference = labs(rawValue - loadcellBaseline);

// 2. Deadband noise rejection
if (difference <= 1500) {
    weightKg = 0.00;
} else {
    // 3. Sensitivity divisor
    weightKg = (float)difference / 12000.0f;
}

// 4. Round to 2 decimal places
weightKg = roundf(weightKg * 100.0f) / 100.0f;
```

**Key Architectural Rules:**
- The raw HX711 integer values are strictly internal to the ESP32 and are **never** displayed on the frontend dashboard.
- The dashboard directly displays the `weight_kg` value in Kilograms (KG).
- JavaScript does not alter or re-calculate the weight formula.

---

## 6. Required Arduino Libraries

Install the following libraries in Arduino IDE (`Tools` → `Manage Libraries...`):

1. **DHT sensor library** by Adafruit (v1.4.6 or later)
2. **Adafruit Unified Sensor** by Adafruit (v1.1.14 or later)
3. **OneWire** by Paul Stoffregen (v2.3.8 or later)
4. **DallasTemperature** by Miles Burton (v3.9.0 or later)
5. **HX711 Arduino Library** by Bogdan Necula (v0.7.5 or later)

---

## 7. ESP32 Firmware Upload Instructions

1. Open Arduino IDE.
2. Open [`ESP32/ESP32.ino`](file:///d:/Project%20Works/trayvanta/ESP32/ESP32.ino).
3. Connect your ESP32 board to your computer via USB.
4. In `Tools` → `Board`, select **ESP32 Dev Module**.
5. In `Tools` → `Port`, select the active COM / `/dev/ttyUSB` port of your ESP32.
6. Verify upload speed is set to `921600` or `115200`.
7. Click **Upload**. Wait until "Done uploading" appears.
8. **Crucial:** Close the Arduino Serial Monitor before connecting on the website (a serial port cannot be opened by two programs simultaneously).

---

## 8. Complete Firebase Setup Guide

Follow these beginner-friendly steps to connect Firebase Cloud Firestore to your TRAYVANTA dashboard:

### Step 1: Create a Firebase Project
1. Open the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** (or **Create a project**).
3. Enter a project name (e.g. `trayvanta-system`).
4. (Optional) Disable Google Analytics for a simple demo setup, then click **Create project**.

### Step 2: Register a Web App
1. On the project overview page, click the **Web icon** (`</>`) to add a web application.
2. Enter an App nickname (e.g. `TRAYVANTA Web`).
3. Leave "Firebase Hosting" unchecked for now, and click **Register app**.

### Step 3: Copy Your Firebase Configuration
1. Firebase will present your `firebaseConfig` object containing:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`
2. Open [`firebase-config.js`](file:///d:/Project%20Works/trayvanta/firebase-config.js) in your project folder.
3. Replace the placeholder values with your exact credentials:
   ```javascript
   export const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "trayvanta-system.firebaseapp.com",
     projectId: "trayvanta-system",
     storageBucket: "trayvanta-system.appspot.com",
     messagingSenderId: "123456789...",
     appId: "1:123456789:web:..."
   };
   ```

### Step 4: Enable Cloud Firestore
1. In the left navigation menu of Firebase Console, click **Build** → **Firestore Database**.
2. Click **Create database**.
3. Choose your database location (e.g. `nam5 (us-central)` or `asia-south1`).
4. Select **Start in test mode** for initial setup (we will configure production rules in Step 6).
5. Click **Create**.

### Step 5: Enable Anonymous Authentication
1. In the left menu, click **Build** → **Authentication**.
2. Click **Get Started**.
3. Under the **Sign-in method** tab, click **Anonymous**.
4. Toggle **Enable**, then click **Save**.
5. *Why?* This allows the TRAYVANTA dashboard to establish an authenticated, secure session to Firestore without requiring the jury to type email passwords during a live demo.

### Step 6: Publish Firestore Security Rules
1. In the Firebase Console, navigate to **Firestore Database** → **Rules** tab.
2. Copy the entire contents of [`firestore.rules`](file:///d:/Project%20Works/trayvanta/firestore.rules):
   ```javascript
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       function isAuthenticated() { return request.auth != null; }

       match /sensorReadings/{readingId} {
         allow read: if isAuthenticated();
         allow create: if isAuthenticated()
           && request.resource.data.deviceId is string
           && request.resource.data.source in ['LIVE', 'SIMULATED'];
         allow update, delete: if false;
       }

       match /products/{productId} {
         allow read: if isAuthenticated();
         allow create, update: if isAuthenticated()
           && request.resource.data.name is string;
         allow delete: if isAuthenticated();
       }

       match /alerts/{alertId} {
         allow read: if isAuthenticated();
         allow create: if isAuthenticated();
         allow update, delete: if false;
       }

       match /appSettings/{settingDoc} {
         allow read, write: if isAuthenticated();
       }

       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```
3. Click **Publish**.

### Step 7: Automatic Collection Creation
You do **not** need to manually create collections in Firestore. When the dashboard saves its first sensor reading or product, Firestore automatically creates:
- `sensorReadings`: Periodic 10-second snapshots and warning records.
- `products`: Manually registered food items with expiry and weight.
- `alerts`: Emergency alerts for critical temperature or gas anomalies.
- `appSettings`: User-configured thresholds.

---

## 9. Rule-Based Food Risk Classification

The system incorporates a transparent, deterministic rule-based evaluation engine:

```
[ EVALUATION PIPELINE ]
  Input: Product Expiry Date + Real-Time Refrigerator Temperature
  Priority: REMOVE > SELL FIRST > INSPECT > SAFE
```

| Classification | Priority | Trigger Conditions | Action & Explanation |
| :--- | :--- | :--- | :--- |
| **REMOVE** (Red) | 1 (Highest) | Expiry date in past **OR** Tray Temperature ≥ 9.0°C | "Expiry date passed or critical storage temperature detected." Discard item immediately. |
| **SELL FIRST** (Orange) | 2 (High) | Expiry date is today **OR** Expiry within next 2 calendar days | "Expiry is approaching." Prioritize consumption or discount. |
| **INSPECT** (Yellow) | 3 (Moderate) | Tray Temp > 5.0°C and < 9.0°C **OR** Expiry within next 4 calendar days | "Temperature requires review or expiry is approaching." Check seal and monitor chiller. |
| **SAFE** (Green) | 4 (Default) | Tray Temp ≤ 5.0°C **AND** Expiry > 4 calendar days | "No configured threshold crossed." Standard chilled storage maintained. |

> **Note:** The MQ135 sensor generates separate atmospheric anomaly warnings and does not independently classify product spoilage.

---

## 10. Live Mode vs Dummy Simulation Mode

### Live Hardware Mode
1. Connect ESP32 to PC via USB.
2. Click **CONNECT ESP32** in the header.
3. Select your serial port in the browser prompt.
4. The dashboard displays **LIVE DATA** (green pill).
5. Live sensor readings stream every ~1 second and are saved to Firestore every 10 seconds.

### Dummy Demonstration Mode
1. Click **START DEMO** in the header.
2. The dashboard activates the purple **SIMULATED DATA** mode.
3. Realistic, gradual telemetry fluctuations run automatically without hardware.
4. Click **Simulate Temp Rise** in the banner to raise the temperature and observe the Risk Analysis module dynamically transition items to *INSPECT* and *REMOVE*.
5. When physical ESP32 is connected, the simulation terminates automatically.

---

## 11. Vercel Deployment Instructions

The project consists of standard modular HTML5, CSS3, and modern ES6 JavaScript modules with zero build overhead:

1. Install Vercel CLI (or connect GitHub to Vercel):
   ```bash
   npm install -g vercel
   ```
2. In the project root directory, run:
   ```bash
   vercel
   ```
3. Set project settings:
   - Framework preset: `Other`
   - Root directory: `./`
4. Deploy to production:
   ```bash
   vercel --prod
   ```
5. Open your live HTTPS URL. Web Serial functions directly on HTTPS contexts!

---

## 12. Testing Checklist

- [x] **Web Serial:** 115200 baud USB connection opens and streams telemetry.
- [x] **Load Cell Logic:** Preserved formula (`diff <= 1500 -> 0.00`, divisor `12000.0`), display in KG only.
- [x] **Digital Twin:** Single tray with capacity gauge, live overlay, product cards, ambient illumination.
- [x] **Monitoring:** 4 sensor cards, interactive canvas telemetry chart, live terminal.
- [x] **Inventory:** Add, view, edit, delete food items with category and expiry filters.
- [x] **Risk Analysis:** Automatic classification (REMOVE > SELL FIRST > INSPECT > SAFE), rule breakdown.
- [x] **History & CSV:** 10s cloud snapshots, warning transitions, filterable table, CSV export.
- [x] **Simulation Mode:** Smooth gradual drift, temp rise trigger, source tagging.
- [x] **Firebase Integration:** Modular SDK, anonymous auth, fallback cache when offline.

---

## 13. Project File Structure

```
TRAYVANTA/
│
├── index.html              # Upgraded 5-module dashboard & digital twin UI
├── style.css               # Dark theme design system & responsive layout
├── script.js               # ES module controller (Serial, Risk Engine, Chart, UI)
│
├── firebase-config.js      # Client credentials & config detection helper
├── firebase.js             # Modular Firebase SDK (Firestore, Auth, Local Cache)
├── firestore.rules         # Strict production security rules
├── firestore.indexes.json  # Query index specifications
├── firebase.json           # Firebase project & hosting configuration
│
├── ESP32/
│   └── ESP32.ino           # Consolidated firmware with 5-sensor drivers
│
└── README.md               # Complete architecture & deployment guide
```
