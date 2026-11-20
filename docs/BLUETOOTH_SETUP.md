# ESP32 Bluetooth Serial Setup & Command Control Guide

This guide explains how to connect to and control your **ESP32 Water Level Monitoring System** locally using **Bluetooth Serial (Classic / BLE)** without needing a Wi-Fi or Web Cloud connection.

---

## 1. Bluetooth Connection Setup

1. **Power on the ESP32 system**: The board will start broadcasting Bluetooth automatically.
2. **Device Name**: `ESP32_WaterMonitor`
3. **Pairing via Smartphone or PC**:
   - Go to your mobile phone or PC Bluetooth settings.
   - Scan for available devices and pair with `ESP32_WaterMonitor` (PIN: `0000` or `1234` if prompted).

---

## 2. Supported Bluetooth Modes & Mobile Apps

The system features **Dual Bluetooth**:
1. **Bluetooth Classic (SPP)**: Compatible with Android apps like *Serial Bluetooth Terminal* or *Dabble*.
2. **Bluetooth Low Energy (BLE GATT)**: Native support for **BLE Controller** apps on iOS and Android via the standard **Nordic UART Service (NUS)**.

### BLE GATT Service Specifications:
- **Device Name**: `ESP32_WaterMonitor`
- **Service UUID**: `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`
- **RX Characteristic (Write Command)**: `6E400002-B5A3-F393-E0A9-E50E24DCCA9E`
- **TX Characteristic (Notify Telemetry)**: `6E400003-B5A3-F393-E0A9-E50E24DCCA9E`

---

### Recommended BLE Apps:
- **BLE Controller** / **BLE Terminal** (iOS & Android).
- **Dabble** (Terminal / Controller Mode).
- **nRF Connect for Mobile** (Nordic Semiconductor).
- **Web Bluetooth**: Chrome/Edge web simulator (`web_simulator/index.html`).

---

## 3. Live Bluetooth Telemetry

Once connected, the ESP32 automatically sends real-time status updates every 2 seconds:

```text
[TELEMETRY] LEVEL:45% | VOL:22.5L | MODE:AUTO | SOLENOID:CLOSED | PUMP:OFF
```

Additionally, automated system event alerts are instantly broadcasted:
- `[ALERT] Fill limit reached (>=75%). Solenoid Valve CLOSED.`
- `[ALERT] OVERFLOW WARNING! Diaphragm Pump ACTIVATED.`
- `[ALERT] Tank drained to safe target. Diaphragm Pump STOPPED.`

---

## 4. Bluetooth Serial Command Reference

Send the following ASCII text commands (ending with `\n` newline) over Bluetooth Serial:

| Command | Action | Example Output / Response |
| :--- | :--- | :--- |
| `STATUS` | Requests instant system status breakdown | `LEVEL:45% \| VOL:22.5L \| MODE:AUTO \| SOLENOID:CLOSED \| PUMP:OFF` |
| `MODE:AUTO` (or `AUTO:1`) | Enables Automatic Threshold Control Mode | `SUCCESS: Mode set to AUTOMATIC` |
| `MODE:MANUAL` (or `AUTO:0`) | Enables Manual Relay Override Mode | `SUCCESS: Mode set to MANUAL OVERRIDE` |
| `SOLENOID:1` | Opens 12V Solenoid Valve (Manual mode only) | `SUCCESS: Solenoid Valve OPENED` |
| `SOLENOID:0` | Closes 12V Solenoid Valve (Manual mode only) | `SUCCESS: Solenoid Valve CLOSED` |
| `PUMP:1` | Starts 12V Diaphragm Pump (Manual mode only) | `SUCCESS: Diaphragm Pump STARTED` |
| `PUMP:0` | Stops 12V Diaphragm Pump (Manual mode only) | `SUCCESS: Diaphragm Pump STOPPED` |
| `SETFILL:<30-95>` | Sets inflow cutoff percentage threshold | `SUCCESS: Fill Stop Level set to 75%` |
| `SETDRAIN:<10-74>` | Sets drain stop target percentage threshold | `SUCCESS: Drain Target Level set to 50%` |
| `HELP` | Prints available command options | `COMMANDS: STATUS, MODE:AUTO, MODE:MANUAL...` |

---

## 5. Mobile Phone Step-by-Step Operation Guide

### Step 1: Pair ESP32 with your Mobile Phone
1. Turn on power to your ESP32 Water System.
2. Open **Settings** -> **Bluetooth** on your Android/iOS phone.
3. Tap **Pair new device** and select **`ESP32_WaterMonitor`**.
4. Confirm pairing (PIN is `0000` or `1234` if prompted).

---

### Step 2: Download & Connect via Bluetooth App
- **Android**: Install **Serial Bluetooth Terminal** from the Google Play Store.
- **iOS**: Install **BLE Terminal** or **Dabble** from the Apple App Store.

#### In the App:
1. Open **Serial Bluetooth Terminal**.
2. Open the side menu (top-left **≡**) and tap **Devices**.
3. Under *Bluetooth Classic*, tap **`ESP32_WaterMonitor`**.
4. Tap the **Link / Connect icon** (top-right).
5. Once connected, you will immediately see live updates every 2 seconds:
   ```text
   [TELEMETRY] LEVEL:45% | VOL:22.5L | MODE:AUTO | SOLENOID:CLOSED | PUMP:OFF
   ```

---

### Step 3: Setup Easy 1-Tap Control Buttons (Macros)
In **Serial Bluetooth Terminal** (Android), you can create 1-tap touch buttons at the bottom of your screen so you don't have to type commands manually:

1. Long-press any button slot (e.g. **M1**, **M2**, **M3**...).
2. Configure the buttons as follows:

| Button Label | Edit Value (Value to Send) | Function |
| :--- | :--- | :--- |
| **STATUS** | `STATUS` | Check live water level & relay status |
| **AUTO MODE** | `MODE:AUTO` | Turn on Automatic filling/draining |
| **MANUAL** | `MODE:MANUAL` | Turn on Manual override mode |
| **OPEN SOLENOID** | `SOLENOID:1` | Open 12V Solenoid Valve (Fill water) |
| **CLOSE SOLENOID** | `SOLENOID:0` | Close Solenoid Valve (Stop fill) |
| **START PUMP** | `PUMP:1` | Turn ON 12V Diaphragm Pump (Drain water) |
| **STOP PUMP** | `PUMP:0` | Turn OFF Diaphragm Pump |
| **FILL 75%** | `SETFILL:75` | Set fill stop threshold to 75% |
| **DRAIN 50%** | `SETDRAIN:50` | Set drain target threshold to 50% |

3. Save the buttons. Now you can control your water tank system with a single tap on your phone screen!

---

## 6. Non-Volatile Memory (EEPROM) Storage

All configuration changes sent via Bluetooth (`SETFILL`, `SETDRAIN`, `MODE`) are automatically saved to ESP32 **EEPROM flash memory**. If power is lost or restarted, the ESP32 will reboot with your saved thresholds.
