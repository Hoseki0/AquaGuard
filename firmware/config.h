/**
 * @file config.h
 * @brief Configuration parameters and pin definitions for ESP32 Water Level Monitoring System
 *        (Custom App & Bluetooth Control).
 */

#ifndef CONFIG_H
#define CONFIG_H

// ==========================================
// 1. BLUETOOTH CONFIGURATION
// ==========================================
// Bluetooth Device Name broadcasted to your custom mobile app
#define BT_DEVICE_NAME        "ESP32_WaterMonitor"

// Bluetooth Telemetry Push Interval (milliseconds)
#define BT_TELEMETRY_INTERVAL 1000 // Send live JSON/ASCII telemetry every 1 sec

// ==========================================
// 2. HARDWARE PIN DEFINITIONS
// ==========================================
// Sensor Inputs
#define PIN_WATER_SENSOR    36   // Analog Pin VP (ADC1_CH0) for depth sensor

// Relay Output Channels (4-Channel Relay)
#define PIN_RELAY_PUMP      27   // Channel 2: 12V Diaphragm Pump (Main Water Release / Outflow)
#define PIN_RELAY_SOLENOID  26   // Channel 1: Unused / Reserved (Solenoid Valve Removed)
#define PIN_RELAY_AUX1      14   // Channel 3: Auxiliary / Alarm Relay
#define PIN_RELAY_AUX2      12   // Channel 4: Auxiliary Output

// Audible Alarm / Indicator
#define PIN_BUZZER          33   // Active Buzzer for Overflow Warning
#define PIN_STATUS_LED      2    // Built-in ESP32 Status LED

// ==========================================
// 3. RELAY TRIGGER LOGIC (PER CHANNEL)
// ==========================================
// true  = Active LOW relay  (ON = LOW,  OFF = HIGH)
// false = Active HIGH relay (ON = HIGH, OFF = LOW)
//
// If a device does the OPPOSITE of what you command (e.g. pump runs
// when it says OFF), flip that channel's value below and re-upload.
// Field test result: this relay board behaves as ACTIVE HIGH.
#define SOLENOID_RELAY_ACTIVE_LOW  false
#define PUMP_RELAY_ACTIVE_LOW      false
#define AUX_RELAY_ACTIVE_LOW       false

#define SOLENOID_ON   (SOLENOID_RELAY_ACTIVE_LOW ? LOW  : HIGH)
#define SOLENOID_OFF  (SOLENOID_RELAY_ACTIVE_LOW ? HIGH : LOW)
#define PUMP_ON       (PUMP_RELAY_ACTIVE_LOW     ? LOW  : HIGH)
#define PUMP_OFF      (PUMP_RELAY_ACTIVE_LOW     ? HIGH : LOW)
#define AUX_OFF       (AUX_RELAY_ACTIVE_LOW      ? HIGH : LOW)

// ==========================================
// 4. DEFAULT WATER LEVEL THRESHOLDS (%)
// ==========================================
#define DEFAULT_FILL_STOP_LEVEL   75  // Refill pump stops filling when tank reaches 75%
#define DEFAULT_OVERFLOW_TRIGGER  82  // Solenoid valve opens to release water if level >= 82%
#define DEFAULT_DRAIN_TARGET_LEVEL 50 // Solenoid valve closes once water releases down to 50%
#define DEFAULT_TANK_CAPACITY_L   5.32f // Total tank capacity in Liters (5.32 L box)

// ==========================================
// 5. SENSOR CALIBRATION (ADC VALUES 0-4095)
// ==========================================
#define SENSOR_MIN_ADC      250  // ADC reading when tank is empty (0%)
#define SENSOR_MAX_ADC      3200 // ADC reading when tank is full (100%)
#define FILTER_SAMPLES      10   // Moving average sample count

// ==========================================
// 6. TANK & SENSOR GEOMETRY (centimetres)
// ==========================================
// The red PCB water sensor only senses along its ~4 cm copper traces.
// Level % (0-100) = how much of the TRACES are under water.
// Real height = SENSOR_TIP_HEIGHT_CM + (level% * SENSOR_TRACE_LENGTH_CM)
// Measure with a ruler from the box floor and adjust these values:
#define BOX_HEIGHT_CM          15.0f  // Inside height of the 5.32 L box
#define SENSOR_TIP_HEIGHT_CM    6.0f  // Bottom tip of sensor (top is at 12 cm)
#define SENSOR_TRACE_LENGTH_CM  4.0f  // Length of the exposed copper traces

// Control loop interval (milliseconds)
#define CONTROL_LOOP_INTERVAL 500 // System control loop runs every 500ms

#endif // CONFIG_H
