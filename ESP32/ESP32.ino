/*
 * TRAYVANTA - Intelligent Refrigerator Tray Monitoring System
 * Tagline: "Smart Monitoring. Better Food Preservation."
 *
 * Microcontroller: ESP32 Dev Module
 * Communication: USB Serial (Baud Rate: 115200)
 * Protocol: Single-line JSON messages over Serial
 *
 * Sensors:
 *  - DHT22 (Ambient Temperature & Humidity) -> GPIO 4
 *  - DS18B20 Waterproof Probe (Tray Temperature) -> GPIO 16 (4.7k pull-up to 3.3V)
 *  - MQ135 Gas Sensor (Air Quality / Anomaly) -> GPIO 34 (via safe voltage divider)
 *  - 5KG Load Cell + HX711 Amplifier (Tray Weight) -> DT: GPIO 26, SCK: GPIO 27
 *
 * IMPORTANT:
 *  - Raw HX711 values are strictly kept internal and NEVER sent over Serial.
 *  - Sends one complete, valid JSON object per line using Serial.println().
 *  - No debugging text is interleaved with the periodic JSON stream.
 */

#include <DHT.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "HX711.h"

// ==========================================
// 1. HARDWARE PIN DEFINITIONS & CONFIGURATION
// ==========================================
#define DHTPIN               4        // DHT22 data pin
#define DHTTYPE              DHT22    // DHT 22 (AM2302)

#define ONE_WIRE_BUS         16       // DS18B20 data pin (Requires 4.7k pull-up to 3.3V)

#define MQ135_PIN            34       // MQ135 Analog Output (ADC1_CH6 - Input only)

#define LOADCELL_DOUT_PIN    26       // HX711 Data (DT) pin
#define LOADCELL_SCK_PIN     27       // HX711 Clock (SCK) pin

// ==========================================
// 2. LOAD CELL DEMONSTRATION CONSTANTS
// ==========================================
// Accepted demonstration mapping parameters:
const long  LOADCELL_NOISE_THRESHOLD = 1500;   // Noise deadband: difference <= 1500 -> 0.00 KG
const float LOADCELL_SENSITIVITY     = 12000.0; // Difference to KG divisor
const int   BASELINE_SAMPLES         = 20;     // Startup unloaded baseline averaging samples

// ==========================================
// 3. SENSOR OBJECTS & STATE VARIABLES
// ==========================================
DHT dht(DHTPIN, DHTTYPE);

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature ds18b20(&oneWire);

HX711 scale;

// Load Cell state
long  loadcellBaseline = 0;
bool  loadcellInitialized = false;

// MQ135 Moving Average Filter (5 samples)
const int MQ135_FILTER_SIZE = 5;
int   mq135Buffer[MQ135_FILTER_SIZE] = {0};
int   mq135BufferIndex = 0;
bool  mq135BufferFilled = false;

// Timing Control
unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL_MS = 1000; // 1-second transmission interval

// ==========================================
// 4. SETUP
// ==========================================
void setup() {
  // Initialize USB Serial at required 115200 baud
  Serial.begin(115200);
  delay(1000); // Allow serial transceiver to stabilize

  // Configure ESP32 ADC for MQ135 (12-bit resolution: 0-4095, 11dB attenuation: ~0 - 3.3V)
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  pinMode(MQ135_PIN, INPUT);

  // Initialize DHT22
  dht.begin();

  // Initialize DS18B20
  ds18b20.begin();
  ds18b20.setWaitForConversion(false); // Non-blocking temperature conversions

  // Initialize HX711 Load Cell Amplifier
  scale.begin(LOADCELL_DOUT_PIN, LOADCELL_SCK_PIN);

  // Measure startup baseline with tray empty
  if (scale.wait_ready_timeout(1000)) {
    long baselineSum = 0;
    int successfulSamples = 0;

    for (int i = 0; i < BASELINE_SAMPLES; i++) {
      if (scale.wait_ready_timeout(200)) {
        baselineSum += scale.read();
        successfulSamples++;
      }
      delay(40);
    }

    if (successfulSamples > 0) {
      loadcellBaseline = baselineSum / successfulSamples;
      loadcellInitialized = true;
    }
  }

  // Pre-seed MQ135 filter
  int initialAdc = analogRead(MQ135_PIN);
  for (int i = 0; i < MQ135_FILTER_SIZE; i++) {
    mq135Buffer[i] = initialAdc;
  }
  mq135BufferFilled = true;

  // Request first DS18B20 conversion
  ds18b20.requestTemperatures();
}

// ==========================================
// 5. HELPER: MQ135 FILTERED READING
// ==========================================
int getFilteredMQ135Raw() {
  int raw = analogRead(MQ135_PIN);
  mq135Buffer[mq135BufferIndex] = raw;
  mq135BufferIndex = (mq135BufferIndex + 1) % MQ135_FILTER_SIZE;

  long sum = 0;
  for (int i = 0; i < MQ135_FILTER_SIZE; i++) {
    sum += mq135Buffer[i];
  }
  return (int)(sum / MQ135_FILTER_SIZE);
}

// ==========================================
// 6. MAIN LOOP
// ==========================================
void loop() {
  unsigned long currentMillis = millis();

  // Periodic sensor collection and JSON dispatch (~1000ms)
  if (currentMillis - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = currentMillis;

    // ----------------------------------------------------
    // SENSOR 1: DHT22 (Environment Temp & Humidity)
    // ----------------------------------------------------
    float envTemp = dht.readTemperature();
    float envHum  = dht.readHumidity();
    bool envValid = (!isnan(envTemp) && !isnan(envHum) && envTemp > -40.0 && envTemp < 80.0 && envHum >= 0.0 && envHum <= 100.0);

    // ----------------------------------------------------
    // SENSOR 2: DS18B20 (Refrigerator Tray Temperature)
    // ----------------------------------------------------
    float trayTemp = ds18b20.getTempCByIndex(0);
    // Request conversion for the next cycle
    ds18b20.requestTemperatures();
    // DS18B20 returns DEVICE_DISCONNECTED_C (-127.0) or 85.0 (power-on reset glitch) when faulty
    bool trayTempValid = (trayTemp > -55.0 && trayTemp < 125.0 && trayTemp != 85.0 && trayTemp != DEVICE_DISCONNECTED_C);

    // ----------------------------------------------------
    // SENSOR 3: MQ135 (Gas / Air Quality)
    // ----------------------------------------------------
    int mq135Raw = getFilteredMQ135Raw();
    // ESP32 ADC: 0 - 4095 mapped to 0.0 - 3.30V
    float mq135Voltage = (float)mq135Raw * (3.30f / 4095.0f);
    bool mq135Valid = (mq135Raw >= 0 && mq135Raw <= 4095);

    // ----------------------------------------------------
    // SENSOR 4: Load Cell + HX711 Demonstration Mapping
    // ----------------------------------------------------
    float weightKg = 0.00;
    bool  loadcellStatusOk = false;

    if (scale.wait_ready_timeout(100)) {
      long rawValue = scale.read();
      long difference = labs(rawValue - loadcellBaseline);

      if (difference <= LOADCELL_NOISE_THRESHOLD) {
        weightKg = 0.00;
      } else {
        weightKg = (float)difference / LOADCELL_SENSITIVITY;
      }

      // Round to 2 decimal places
      weightKg = roundf(weightKg * 100.0f) / 100.0f;
      loadcellStatusOk = true;
    } else {
      // If scale wasn't initialized or timed out
      loadcellStatusOk = loadcellInitialized && scale.is_ready();
    }

    // ----------------------------------------------------
    // 7. BUILD AND EMIT STRICT JSON OVER SERIAL
    // ----------------------------------------------------
    // Note: Raw HX711 value is strictly OMITTED as per specification.
    // Disconnected sensors emit `null` rather than fake zeros.
    Serial.print("{\"device\":\"TRAYVANTA\"");
    Serial.print(",\"firmware_version\":\"1.0.0\"");

    // Environment Temperature
    if (envValid) {
      Serial.print(",\"environment_temperature\":");
      Serial.print(envTemp, 2);
    } else {
      Serial.print(",\"environment_temperature\":null");
    }

    // Environment Humidity
    if (envValid) {
      Serial.print(",\"environment_humidity\":");
      Serial.print(envHum, 2);
    } else {
      Serial.print(",\"environment_humidity\":null");
    }

    // Refrigerator Tray Temperature
    if (trayTempValid) {
      Serial.print(",\"refrigerator_temperature\":");
      Serial.print(trayTemp, 2);
    } else {
      Serial.print(",\"refrigerator_temperature\":null");
    }

    // MQ135 Gas Readings
    if (mq135Valid) {
      Serial.print(",\"mq135_raw\":");
      Serial.print(mq135Raw);
      Serial.print(",\"mq135_voltage\":");
      Serial.print(mq135Voltage, 2);
    } else {
      Serial.print(",\"mq135_raw\":null,\"mq135_voltage\":null");
    }

    // Tray Weight (Demonstration KG)
    if (loadcellStatusOk) {
      Serial.print(",\"weight_kg\":");
      Serial.print(weightKg, 2);
      Serial.print(",\"loadcell_status\":\"CONNECTED\"");
    } else {
      Serial.print(",\"weight_kg\":null");
      Serial.print(",\"loadcell_status\":\"DISCONNECTED\"");
    }

    // General Device Status
    Serial.println(",\"status\":\"CONNECTED\"}");
  }
}
