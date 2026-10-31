# TRAYVANTA

### Intelligent Refrigerator Tray Monitoring System
> **"Smart Monitoring. Better Food Preservation."**

TRAYVANTA is an IoT-based single-tray refrigerator monitoring system designed to monitor individual refrigerator trays using an ESP32 microcontroller and high-precision sensors. All sensor telemetry is transmitted directly to a web dashboard over **USB Serial Communication** using the modern browser **Web Serial API**—requiring zero external cloud platforms or backend servers.

---

## 1. Hardware Components

| Component | Specification / Purpose |
| :--- | :--- |
| **Microcontroller** | ESP32 Dev Module (NodeMCU / WROOM-32) |
| **Environment Sensor** | DHT22 (Ambient Temperature & Humidity) |
| **Tray Temperature Sensor** | DS18B20 Waterproof Probe (Tray Temperature) |
| **Air Quality / Gas Sensor** | MQ135 (Air Quality / Gas Anomaly Detection) |
| **Weight Sensor** | 5KG Load Cell |
| **Amplifier** | HX711 24-Bit ADC Weight Sensor Module |
| **Communication Cable** | High-quality Micro-USB / USB-C to PC |
| **Resistors** | 4.7kΩ pull-up resistor for DS18B20; voltage divider for MQ135 AO |

---

## 2. ESP32 Hardware Pin Connections

| Sensor / Module Pin | ESP32 GPIO | Electrical Connection Notes |
| :--- | :--- | :--- |
| **DHT22 DATA** | **GPIO 4** | Power: 3.3V & GND. |
| **DS18B20 DATA** | **GPIO 16** | Power: 3.3V & GND. Requires a **4.7kΩ pull-up resistor** between DATA and 3.3V. |
| **MQ135 AO** | **GPIO 34** | Power: 5V (heater) & GND. **Crucial:** ESP32 GPIO34 is not 5V-tolerant; connect via voltage divider (e.g., 1kΩ / 2kΩ) to keep signal ≤ 3.3V. |
| **HX711 DT (DOUT)** | **GPIO 26** | Power: 3.3V & Common GND. Channel A used. |
| **HX711 SCK (CLK)** | **GPIO 27** | Power: 3.3V & Common GND. |

---

## 3. Load Cell to HX711 Wiring

Connect the 4-wire 5KG load cell directly to the HX711 amplifier terminal block:

| Load Cell Wire Color | HX711 Terminal Pin | Function |
| :--- | :--- | :--- |
| **Red** | **E+** | Excitation Positive |
| **Black** | **E-** | Excitation Ground |
| **Green** | **A+** | Channel A Positive Signal |
| **White** | **A-** | Channel A Negative Signal |

*(Note: Terminals B+ and B- are not used for Channel A).*

---

## 4. Required Arduino Libraries

Install the following libraries in Arduino IDE (`Tools` → `Manage Libraries...`) or via VS Code PlatformIO:

1. **DHT sensor library** by Adafruit (v1.4.6 or later)
2. **Adafruit Unified Sensor** by Adafruit (v1.1.14 or later)
3. **OneWire** by Paul Stoffregen (v2.3.8 or later)
4. **DallasTemperature** by Miles Burton (v3.9.0 or later)
5. **HX711 Arduino Library** by Bogdan Necula (v0.7.5 or later)

---

## 5. ESP32 Firmware Upload Instructions

1. Open Arduino IDE.
2. Open [`ESP32/ESP32.ino`](file:///d:/Project%20Works/trayvanta/ESP32/ESP32.ino).
3. Connect your ESP32 board to your computer via USB.
4. In `Tools` → `Board`, select **ESP32 Dev Module**.
5. In `Tools` → `Port`, select the active COM / `/dev/ttyUSB` port of your ESP32.
6. Verify upload speed is set to `921600` or `115200`.
7. Click **Upload**. Wait until "Done uploading" appears.
8. Ensure the Arduino Serial Monitor is **closed** before opening the web dashboard (a serial port can only be opened by one program at a time).

---

## 6. USB Serial Connection Instructions

1. Open the hosted TRAYVANTA website (e.g. on Vercel or locally via a web server).
2. Connect your programmed ESP32 to the computer using the USB cable.
3. Click the **CONNECT ESP32** button in the header.
4. The browser will open its native serial port selector dialog.
5. Select your ESP32 device / COM port and click **Connect**.
6. The dashboard indicator will turn green: **ESP32 CONNECTED**.
7. Sensor cards and the live serial monitor will begin updating every second.

---

## 7. Supported Browsers

Web Serial API requires a Chromium-based desktop browser running in a secure HTTPS context or `localhost`:

* **Google Chrome Desktop** (v89+)
* **Microsoft Edge Desktop** (v89+)
* **Opera Desktop** (v75+)

*(Note: Web Serial is not supported on Firefox, Safari, or mobile browsers).*

---

## 8. Vercel Deployment Instructions

The frontend is built using standard static HTML5, CSS3, and Vanilla JavaScript—no build step or backend required:

1. Install the Vercel CLI (or connect your GitHub repository to Vercel):
   ```bash
   npm install -g vercel
   ```
2. In the project root directory, run:
   ```bash
   vercel
   ```
3. Follow the CLI prompts to deploy:
   - Set project name (e.g., `trayvanta-n7q4`)
   - Root directory: `./`
4. Deploy to production:
   ```bash
   vercel --prod
   ```
5. Your dashboard will be live at `https://<project-name>.vercel.app`. Web Serial functions directly on HTTPS!

---

## 9. Load Cell Demonstration Mapping Explanation

For this initial single-tray prototype, the Load Cell uses an accepted demonstration mapping:

1. **Unloaded Baseline Measurement:**  
   During ESP32 startup (`setup()`), the firmware checks if the HX711 is ready with an empty tray, samples multiple raw readings, and stores their average as `loadcellBaseline`.

2. **Absolute Difference:**  
   Pressure on the tray can cause raw HX711 values to shift in either direction depending on the mechanical strain orientation. The firmware calculates:  
   `difference = abs(rawValue - loadcellBaseline);`

3. **Noise Threshold (1500):**  
   If `difference <= 1500`, small electrical noise and tray vibrations are filtered to display `0.00 KG`.

4. **Demonstration Sensitivity Divisor (12000.0):**  
   If `difference > 1500`, the demonstration weight is calculated as:  
   `weight = difference / 12000.0;`

5. **No 5KG Software Ceiling:**  
   The demonstration calculation dynamically increases above 5KG as pressure increases.

---

## 10. How to Configure Baseline, Noise Threshold, & Sensitivity

In [`ESP32/ESP32.ino`](file:///d:/Project%20Works/trayvanta/ESP32/ESP32.ino), locate lines 37–41:

```cpp
// Change noise threshold (deadband)
const long  LOADCELL_NOISE_THRESHOLD = 1500;

// Change sensitivity divisor (higher value = less weight per raw unit)
const float LOADCELL_SENSITIVITY     = 12000.0;

// Number of startup samples for empty tray reference
const int   BASELINE_SAMPLES         = 20;
```

Modify these values and re-upload the firmware to tune the sensitivity to your tray mechanical structure.

---

## 11. Important Calibration Disclaimer

> **Note:** The calculated demonstration kilogram (KG) values in this prototype are intended for functional integration demonstration, pressure deviation response, and prototype verification. They do **not** represent certified physical weight measurements. To obtain certified physical measurements, perform standard multi-point calibration with known physical weights.

---

## 12. Project File Structure

```
TRAYVANTA/
├── index.html        # Complete dashboard UI & structure
├── style.css         # Modern commercial IoT styling & alert animations
├── script.js         # Web Serial API handler, JSON parsing, & alert logic
├── ESP32/
│   └── ESP32.ino     # Consolidated ESP32 firmware with sensor drivers
└── README.md         # Comprehensive hardware & setup documentation
```
