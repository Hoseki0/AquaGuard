/**
 * @file water_level_monitor.ino
 * @brief ESP32 Firmware for Water Level Monitoring & Automated 12V Control
 *        Tailored for iOS & Android Mobile Apps via BLE (Nordic UART Service).
 * 
 * Hardware:
 *   - ESP32 Development Board
 *   - 12V Battery + Buck Converter (5V Out)
 *   - 4-Channel Relay Module
 *   - 12V Solenoid Valve (Water Release / Outflow Drainage)
 *   - 12V Diaphragm Pump (Inline Water Release Pump)
 *   - Analog Water Level Depth Sensor
 */

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <EEPROM.h>
#include "config.h"

// BLE Server & Characteristics (Nordic UART Service)
BLEServer* pServer = nullptr;
BLECharacteristic* pTxCharacteristic = nullptr;
volatile bool bleDeviceConnected = false;
bool oldBleDeviceConnected = false;
String bleRxBuffer = "";
volatile bool bleCommandReady = false;
portMUX_TYPE bleMux = portMUX_INITIALIZER_UNLOCKED;

void bleSendString(const String& msg) {
  if (!bleDeviceConnected || pTxCharacteristic == nullptr) return;
  // Chunk at 20 bytes for maximum compatibility across iOS and Android BLE MTUs
  const size_t chunkSize = 20;
  size_t len = msg.length();
  for (size_t offset = 0; offset < len; offset += chunkSize) {
    size_t partLen = min(chunkSize, len - offset);
    String part = msg.substring(offset, offset + partLen);
    pTxCharacteristic->setValue((uint8_t*)part.c_str(), part.length());
    pTxCharacteristic->notify();
    if (offset + partLen < len) {
      delay(5);
    }
  }
}

class AquaServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) override {
    bleDeviceConnected = true;
    Serial.println(F("[BLE] Client connected."));
  }

  void onDisconnect(BLEServer* server) override {
    bleDeviceConnected = false;
    Serial.println(F("[BLE] Client disconnected."));
  }
};

class AquaRxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String rxVal = pCharacteristic->getValue();
    if (rxVal.length() > 0) {
      portENTER_CRITICAL(&bleMux);
      bleRxBuffer += rxVal;
      if (bleRxBuffer.indexOf('\n') != -1) {
        bleCommandReady = true;
      }
      portEXIT_CRITICAL(&bleMux);
    }
  }
};

// EEPROM Address Map
#define EEPROM_SIZE          32
#define ADDR_FILL_THRESHOLD  0
#define ADDR_DRAIN_THRESHOLD 4
#define ADDR_MODE            8

// Global State Variables
int currentWaterLevelPercent = 0;
float currentWaterVolumeLiters = 0.0;
int rawAdcValue = 0;
float currentWaterHeightCm = 0.0;

// Dynamic Threshold Parameters (Loaded from EEPROM)
int fillStopThreshold = DEFAULT_FILL_STOP_LEVEL;       // Auto Release trigger: pump + solenoid start at 75%
int drainTargetThreshold = DEFAULT_DRAIN_TARGET_LEVEL;   // Auto Release stop: pump + solenoid stop at 50%
int overflowThreshold = DEFAULT_OVERFLOW_TRIGGER;       // Emergency release trigger at 82%

// System Modes
bool isAutoMode = true;             // true = Automatic Control, false = Manual Override
bool solenoidValveState = false;    // Solenoid Valve (Relay Channel 1: Inline Release Valve)
bool diaphragmPumpState = false;    // Diaphragm Pump (Relay Channel 2: Inline Water Release Pump)
bool isDrainingActive = false;      // Drain/Release state latch flag
int highLevelConfirmCount = 0;      // Debounce counter to prevent false dry-run triggers

// Timing Variables
unsigned long lastControlTime = 0;
unsigned long lastTelemetryTime = 0;

// Sensor Moving Average Filter Buffer
int adcSamples[FILTER_SAMPLES];
int sampleIndex = 0;

// Function Declarations
int readFilteredWaterLevelADC();
int calculatePercentage(int rawAdc);
void processAutomatedControl();
void applyRelayStates();
void processBluetoothCommands();
void sendTelemetryToApp();
void loadEEPROMSettings();
void saveEEPROMSettings();
void triggerBuzzerAlert(int durationMs);

void setup() {
  Serial.begin(115200);
  Serial.println(F("\n=========================================="));
  Serial.println(F("  ESP32 WATER LEVEL MONITORING SYSTEM    "));
  Serial.println(F("  (Custom Mobile App & Bluetooth Mode)   "));
  Serial.println(F("=========================================="));

  // Initialize Hardware GPIO Pins
  pinMode(PIN_RELAY_SOLENOID, OUTPUT);
  pinMode(PIN_RELAY_PUMP, OUTPUT);
  pinMode(PIN_RELAY_AUX1, OUTPUT);
  pinMode(PIN_RELAY_AUX2, OUTPUT);
  // PIN_BUZZER removed (no buzzer hardware)
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_WATER_SENSOR, INPUT);

  // Set default relay OFF states safely
  digitalWrite(PIN_RELAY_SOLENOID, SOLENOID_OFF);
  digitalWrite(PIN_RELAY_PUMP, PUMP_OFF);
  digitalWrite(PIN_RELAY_AUX1, AUX_OFF);
  digitalWrite(PIN_RELAY_AUX2, AUX_OFF);
  // digitalWrite(PIN_BUZZER, LOW); // No buzzer
  digitalWrite(PIN_STATUS_LED, LOW);

  // Initialize EEPROM & Load Saved Parameters
  EEPROM.begin(EEPROM_SIZE);
  loadEEPROMSettings();

  // Initialize Moving Average Filter Buffer
  int initialAdc = analogRead(PIN_WATER_SENSOR);
  for (int i = 0; i < FILTER_SAMPLES; i++) {
    adcSamples[i] = initialAdc;
  }

  // Initialize BLE (Nordic UART Service for iOS, Android & WebBLE)
  BLEDevice::init(BT_DEVICE_NAME);
  BLEDevice::setMTU(185);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new AquaServerCallbacks());

  BLEService* pService = pServer->createService(BLE_SERVICE_UUID);
  pTxCharacteristic = pService->createCharacteristic(
    BLE_TX_CHAR_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pTxCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic* pRxCharacteristic = pService->createCharacteristic(
    BLE_RX_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  pRxCharacteristic->setCallbacks(new AquaRxCallbacks());

  pService->start();
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(BLE_SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.print(F("[BLE] Nordic UART Service started as: "));
  Serial.println(BT_DEVICE_NAME);

  Serial.println(F("[System] Setup Complete. Ready for iOS / Android BLE connection."));
}

void loop() {
  // Handle BLE reconnect advertising
  if (!bleDeviceConnected && oldBleDeviceConnected) {
    delay(200);
    pServer->startAdvertising();
    Serial.println(F("[BLE] Restarted advertising."));
    oldBleDeviceConnected = bleDeviceConnected;
  }
  if (bleDeviceConnected && !oldBleDeviceConnected) {
    oldBleDeviceConnected = bleDeviceConnected;
  }

  // Process incoming BLE commands from iOS/Android app
  processBluetoothCommands();

  unsigned long currentMillis = millis();

  // Primary Control Loop
  if (currentMillis - lastControlTime >= CONTROL_LOOP_INTERVAL) {
    lastControlTime = currentMillis;

    // 1. Read & filter water level sensor
    rawAdcValue = readFilteredWaterLevelADC();
    currentWaterLevelPercent = calculatePercentage(rawAdcValue);
    currentWaterHeightCm = SENSOR_TIP_HEIGHT_CM + (currentWaterLevelPercent / 100.0f) * SENSOR_TRACE_LENGTH_CM;
    if (currentWaterLevelPercent == 0) currentWaterHeightCm = 0.0f;  // below sensor tip: unknown, show as low
    currentWaterVolumeLiters = constrain(currentWaterHeightCm / BOX_HEIGHT_CM, 0.0f, 1.0f) * DEFAULT_TANK_CAPACITY_L;

    // 2. Execute Control Logic
    if (isAutoMode) {
      processAutomatedControl();
    }

    // 3. Apply Relay Outputs to Hardware
    applyRelayStates();

    // 4. Status Heartbeat LED Flash
    digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));
  }

  // Bluetooth Telemetry Stream Loop (Sends updates every 1000ms)
  if (currentMillis - lastTelemetryTime >= BT_TELEMETRY_INTERVAL) {
    lastTelemetryTime = currentMillis;
    sendTelemetryToApp();
  }
}

// ==========================================
// SENSOR FILTERING & CONVERSION
// ==========================================
int readFilteredWaterLevelADC() {
  int currentRead = analogRead(PIN_WATER_SENSOR);
  
  adcSamples[sampleIndex] = currentRead;
  sampleIndex = (sampleIndex + 1) % FILTER_SAMPLES;

  long sum = 0;
  for (int i = 0; i < FILTER_SAMPLES; i++) {
    sum += adcSamples[i];
  }
  return (int)(sum / FILTER_SAMPLES);
}

int calculatePercentage(int rawAdc) {
  int pct = map(rawAdc, SENSOR_MIN_ADC, SENSOR_MAX_ADC, 0, 100);
  return constrain(pct, 0, 100);
}

// ==========================================
// AUTOMATED CONTROL STATE MACHINE
// ==========================================
void processAutomatedControl() {
  // --- COMBINED WATER RELEASE CONTROL (Pump + Solenoid Valve) ---
  // The pump is connected inline to the solenoid valve:
  // Solenoid MUST always be OPEN when the pump is draining water.
  // Never run the pump if water level is at/below drain target or dry (<= 5%).

  if (currentWaterLevelPercent <= 5) {
    // Dry / no-water safety cutoff
    highLevelConfirmCount = 0;
    isDrainingActive = false;
    diaphragmPumpState = false;
    solenoidValveState = false;
    return;
  }

  // 1. Trigger Release only after 3 consecutive readings >= fillStopThreshold (prevents noise spikes)
  if (currentWaterLevelPercent >= fillStopThreshold) {
    if (highLevelConfirmCount < 3) {
      highLevelConfirmCount++;
    }
    if (highLevelConfirmCount >= 3 && !isDrainingActive) {
      isDrainingActive = true;
      solenoidValveState = true;  // Open solenoid valve first
      diaphragmPumpState = true;  // Pump pushes water out
      Serial.println(F("[AUTO] High water level confirmed! Solenoid Valve OPENED & Pump STARTED."));
    }
  } else {
    highLevelConfirmCount = 0;
  }

  // 2. Keep Solenoid OPEN & Pump RUNNING until level drops to target threshold (Default <=50%)
  if (isDrainingActive) {
    if (currentWaterLevelPercent <= drainTargetThreshold) {
      isDrainingActive = false;
      diaphragmPumpState = false; // Stop pump
      solenoidValveState = false; // Close solenoid valve
      Serial.println(F("[AUTO] Target safe level reached. Pump STOPPED & Solenoid Valve CLOSED."));
    } else {
      solenoidValveState = true;
      diaphragmPumpState = true;
    }
  } else {
    // When idle and level is normal, ensure both stay safely OFF
    diaphragmPumpState = false;
    solenoidValveState = false;
  }
}

// ==========================================
// RELAY OUTPUT HARDWARE DRIVER
// ==========================================
void applyRelayStates() {
  // Safety interlock: solenoid MUST be open whenever pump is running
  if (diaphragmPumpState && !solenoidValveState) {
    solenoidValveState = true;
  }
  digitalWrite(PIN_RELAY_SOLENOID, solenoidValveState ? SOLENOID_ON : SOLENOID_OFF);
  digitalWrite(PIN_RELAY_PUMP, diaphragmPumpState ? PUMP_ON : PUMP_OFF);
}

// ==========================================
// BLUETOOTH TELEMETRY STREAM TO MOBILE APP
// ==========================================
void sendTelemetryToApp() {
  if (bleDeviceConnected) {
    String packet = "{\"level\":" + String(currentWaterLevelPercent) +
                    ",\"volume\":" + String(currentWaterVolumeLiters, 2) +
                    ",\"mode\":" + String(isAutoMode ? 1 : 0) +
                    ",\"solenoid\":" + String(solenoidValveState ? 1 : 0) +
                    ",\"pump\":" + String(diaphragmPumpState ? 1 : 0) +
                    ",\"fill_target\":" + String(fillStopThreshold) +
                    ",\"drain_target\":" + String(drainTargetThreshold) +
                    ",\"height\":" + String(currentWaterHeightCm, 1) +
                    ",\"adc\":" + String(rawAdcValue) + "}\n";
    bleSendString(packet);
  }
}

// ==========================================
// BLUETOOTH COMMAND PROCESSOR
// ==========================================
void processBluetoothCommands() {
  if (!bleCommandReady) return;

  String pendingLines;
  portENTER_CRITICAL(&bleMux);
  int lastNl = bleRxBuffer.lastIndexOf('\n');
  if (lastNl != -1) {
    pendingLines = bleRxBuffer.substring(0, lastNl + 1);
    bleRxBuffer = bleRxBuffer.substring(lastNl + 1);
  }
  bleCommandReady = (bleRxBuffer.indexOf('\n') != -1);
  portEXIT_CRITICAL(&bleMux);

  int startIdx = 0;
  while (startIdx < (int)pendingLines.length()) {
    int nlIdx = pendingLines.indexOf('\n', startIdx);
    if (nlIdx == -1) break;
    String cmd = pendingLines.substring(startIdx, nlIdx);
    startIdx = nlIdx + 1;

    cmd.trim();
    cmd.toUpperCase();
    if (cmd.length() == 0) continue;

    Serial.print(F("[BLE Command Received]: "));
    Serial.println(cmd);

    if (cmd == "STATUS") {
      String statusMsg = "LEVEL:" + String(currentWaterLevelPercent) + "% | " +
                         "VOL:" + String(currentWaterVolumeLiters, 2) + "L | " +
                         "MODE:" + String(isAutoMode ? "AUTO" : "MANUAL") + " | " +
                         "SOLENOID:" + String(solenoidValveState ? "OPEN" : "CLOSED") + " | " +
                         "PUMP:" + String(diaphragmPumpState ? "ON" : "OFF") + "\n";
      bleSendString(statusMsg);
    }
    else if (cmd == "AUTO:1" || cmd == "MODE:AUTO") {
      isAutoMode = true;
      saveEEPROMSettings();
      bleSendString("OK:MODE_AUTO\n");
    }
    else if (cmd == "AUTO:0" || cmd == "MODE:MANUAL") {
      isAutoMode = false;
      isDrainingActive = false;     // clear auto latch so manual control is clean
      saveEEPROMSettings();
      bleSendString("OK:MODE_MANUAL\n");
    }
    else if (cmd == "SOLENOID:1") {
      isAutoMode = false;           // Switch to manual mode so state is immediate
      solenoidValveState = true;
      applyRelayStates();
      bleSendString("OK:SOLENOID_OPEN\n");
    }
    else if (cmd == "SOLENOID:0") {
      isAutoMode = false;
      solenoidValveState = false;
      // If pump is running, stop it too to prevent deadheading against closed valve
      if (diaphragmPumpState) {
        diaphragmPumpState = false;
      }
      applyRelayStates();
      bleSendString("OK:SOLENOID_CLOSED\n");
    }
    else if (cmd == "PUMP:1") {
      isAutoMode = false;           // Auto switch to manual mode
      diaphragmPumpState = true;
      solenoidValveState = true;    // Open solenoid valve so pump can push water out freely
      applyRelayStates();
      bleSendString("OK:PUMP_STARTED\n");
    }
    else if (cmd == "PUMP:0") {
      isAutoMode = false;           // Auto switch to manual mode
      diaphragmPumpState = false;
      solenoidValveState = false;   // Close solenoid valve when pump stops
      applyRelayStates();
      bleSendString("OK:PUMP_STOPPED\n");
    }
    else if (cmd == "RELEASE:1") {
      isAutoMode = false;
      diaphragmPumpState = true;
      solenoidValveState = true;
      applyRelayStates();
      bleSendString("OK:RELEASE_STARTED\n");
    }
    else if (cmd == "RELEASE:0") {
      isAutoMode = false;
      diaphragmPumpState = false;
      solenoidValveState = false;
      applyRelayStates();
      bleSendString("OK:RELEASE_STOPPED\n");
    }
    else if (cmd.startsWith("SETFILL:")) {
      int val = cmd.substring(8).toInt();
      if (val >= 30 && val <= 95) {
        fillStopThreshold = val;
        saveEEPROMSettings();
        bleSendString("OK:SETFILL_" + String(val) + "\n");
      } else {
        bleSendString("ERR:INVALID_FILL_VALUE\n");
      }
    }
    else if (cmd.startsWith("SETDRAIN:")) {
      int val = cmd.substring(9).toInt();
      if (val >= 10 && val < fillStopThreshold) {
        drainTargetThreshold = val;
        saveEEPROMSettings();
        bleSendString("OK:SETDRAIN_" + String(val) + "\n");
      } else {
        bleSendString("ERR:INVALID_DRAIN_VALUE\n");
      }
    }
    else if (cmd == "HELP") {
      bleSendString("COMMANDS: STATUS, AUTO:1, AUTO:0, SOLENOID:1, SOLENOID:0, PUMP:1, PUMP:0, RELEASE:1, RELEASE:0, SETFILL:75, SETDRAIN:50\n");
    }
    else {
      bleSendString("ERR:UNKNOWN_COMMAND\n");
    }

    // Push fresh state to the app immediately so buttons update instantly
    sendTelemetryToApp();
    lastTelemetryTime = millis();
  }
}

// ==========================================
// EEPROM NON-VOLATILE STORAGE
// ==========================================
void loadEEPROMSettings() {
  int fVal = EEPROM.readInt(ADDR_FILL_THRESHOLD);
  int dVal = EEPROM.readInt(ADDR_DRAIN_THRESHOLD);
  int mVal = EEPROM.readInt(ADDR_MODE);

  if (fVal >= 30 && fVal <= 95) fillStopThreshold = fVal;
  if (dVal >= 10 && dVal < fillStopThreshold) drainTargetThreshold = dVal;
  if (mVal == 0 || mVal == 1) isAutoMode = (mVal == 1);

  Serial.print(F("[EEPROM] Loaded Fill Cutoff: ")); Serial.print(fillStopThreshold);
  Serial.print(F("% | Drain Target: ")); Serial.print(drainTargetThreshold);
  Serial.print(F("% | Mode: ")); Serial.println(isAutoMode ? "AUTO" : "MANUAL");
}

void saveEEPROMSettings() {
  EEPROM.writeInt(ADDR_FILL_THRESHOLD, fillStopThreshold);
  EEPROM.writeInt(ADDR_DRAIN_THRESHOLD, drainTargetThreshold);
  EEPROM.writeInt(ADDR_MODE, isAutoMode ? 1 : 0);
  EEPROM.commit();
  Serial.println(F("[EEPROM] Settings saved."));
}

// triggerBuzzerAlert() removed - no buzzer hardware connected
