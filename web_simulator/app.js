/**
 * AquaGuard Pro — App Engine
 * Features: Web Bluetooth BLE, threshold editing, activity log, stats, emergency stop
 */

document.addEventListener('DOMContentLoaded', () => {

  /* ---- DOM ---- */
  const $ = id => document.getElementById(id);
  const fluidContainer    = $('fluidContainer');
  const tankPercentReadout= $('tankPercentReadout');
  const tankVolumeReadout = $('tankVolumeReadout');
  const tankStateLabel    = $('tankStateLabel');
  const waterSimInput     = $('waterSimInput');
  const capacityBadge     = $('capacityBadge');

  const inflowStream      = $('inflowStream');
  const outflowStream     = $('outflowStream');
  const solenoidNodeState = $('solenoidNodeState');
  const pumpNodeState     = $('pumpNodeState');
  const autoStatusBadge   = $('autoStatusBadge');

  const btnModeAuto       = $('btnModeAuto');
  const btnModeManual     = $('btnModeManual');
  const modeDescription   = $('modeDescription');
  const modeDescFill      = $('modeDescFill');
  const modeDescOverflow  = $('modeDescOverflow');
  const modeDescDrain     = $('modeDescDrain');

  const btnToggleSolenoid = $('btnToggleSolenoid');
  const btnTogglePump     = $('btnTogglePump');
  const relayBox1         = $('relayBox1');
  const relayBox2         = $('relayBox2');
  const relayLed1         = $('relayLed1');
  const relayLed2         = $('relayLed2');
  const solenoidTextStatus= $('solenoidTextStatus');
  const pumpTextStatus    = $('pumpTextStatus');

  // Threshold controls
  const fillStopSlider    = $('fillStopSlider');
  const fillStopInput     = $('fillStopInput');
  const drainTargetSlider = $('drainTargetSlider');
  const drainTargetInput  = $('drainTargetInput');
  const overflowSlider    = $('overflowSlider');
  const overflowInput     = $('overflowInput');
  const tankCapacityInput = $('tankCapacityInput');

  // Tank guide labels
  const fillLineGuide     = $('fillLineGuide');
  const drainLineGuide    = $('drainLineGuide');
  const overflowLineGuide = $('overflowLineGuide');
  const fillTagVal        = $('fillTagVal');
  const drainTagVal       = $('drainTagVal');
  const overflowTagVal    = $('overflowTagVal');
  const fillRulerLabel    = $('fillRulerLabel');
  const drainRulerLabel   = $('drainRulerLabel');
  const overflowRulerLabel= $('overflowRulerLabel');

  // BLE
  const btnConnectBLE     = $('btnConnectBLE');
  const btnEmergencyStop  = $('btnEmergencyStop');
  const bleStatusPill     = $('bleStatusPill');
  const bleStatusText     = $('bleStatusText');

  // Terminal
  const terminalLog       = $('terminalLog');
  const terminalForm      = $('terminalForm');
  const terminalInput     = $('terminalInput');

  // Stats
  const statFillCycles    = $('statFillCycles');
  const statDrainEvents   = $('statDrainEvents');
  const statOverflowEvents= $('statOverflowEvents');
  const statUptime        = $('statUptime');

  // Activity log
  const activityLog       = $('activityLog');
  const btnClearLog       = $('btnClearLog');

  /* ---- Web Bluetooth UUIDs ---- */
  const SVC_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const RX_UUID  = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  const TX_UUID  = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  let bleDevice = null, rxChar = null, txChar = null, bleConnected = false;

  /* ---- State ---- */
  let level = 45;
  let tankCapacity = 50;   // liters
  let isAuto = true;
  let solenoidOpen = false;
  let pumpRunning  = false;
  let draining     = false;

  // Editable thresholds
  let fillThreshold     = 75;
  let drainThreshold    = 50;
  let overflowThreshold = 82;

  // Stats counters
  let fillCycles = 0, drainEvents = 0, overflowEvents = 0;
  let solenoidWasOpen = false, pumpWasRunning = false;
  const sessionStart = Date.now();

  /* ---- PWA ---- */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  /* ============================================================
     UPTIME TIMER
     ============================================================ */
  setInterval(() => {
    const s = Math.floor((Date.now() - sessionStart) / 1000);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    statUptime.textContent = `${h}:${m}:${sec}`;
  }, 1000);

  /* ============================================================
     PHYSICS SIMULATION LOOP
     ============================================================ */
  setInterval(() => {
    if (!bleConnected) {
      if (solenoidOpen && pumpRunning) level = Math.max(0, level - 0.7);
      else if (solenoidOpen || pumpRunning) level = Math.max(0, level - 0.35);
      if (solenoidOpen || pumpRunning) waterSimInput.value = Math.round(level);
      else level = parseFloat(waterSimInput.value);
      if (isAuto) runAutoLogic();
    }

    // Count cycle events (Pump = Pump Cycles, Solenoid = Valve Events)
    if (pumpRunning && !pumpWasRunning)   { fillCycles++;  statFillCycles.textContent  = fillCycles; }
    if (solenoidOpen && !solenoidWasOpen) { drainEvents++; statDrainEvents.textContent = drainEvents; }
    solenoidWasOpen = solenoidOpen;
    pumpWasRunning  = pumpRunning;

    renderUI();
  }, 100);

  function runAutoLogic() {
    // Water Release via Inline Pump + Solenoid Valve
    if (level >= fillThreshold && !draining) {
      draining = true;
      solenoidOpen = true;
      pumpRunning = true;
      overflowEvents++;
      statOverflowEvents.textContent = overflowEvents;
      logTerm(`[AUTO] Level ${level.toFixed(1)}% ≥ ${fillThreshold}%. Solenoid Valve OPENED & Pump STARTED (Release).`, 'err');
      addActivity(`Water release active — pump pushing & valve open (${level.toFixed(0)}%)`, 'warn');
    }

    if (draining) {
      if (level <= drainThreshold) {
        draining = false;
        solenoidOpen = false;
        pumpRunning = false;
        logTerm(`[AUTO] Released to ${drainThreshold}%. Pump STOPPED & Solenoid Valve CLOSED.`, 'out');
        addActivity(`Release complete — level reached safe target (${drainThreshold}%)`, 'ok');
      } else {
        solenoidOpen = true;
        pumpRunning = true;
      }
    }
  }

  /* ============================================================
     RENDER UI
     ============================================================ */
  function renderUI() {
    // Tank fluid
    fluidContainer.style.height = `${level}%`;
    tankPercentReadout.textContent = `${Math.round(level)}%`;
    tankVolumeReadout.textContent  = `${((level / 100) * tankCapacity).toFixed(1)} L`;

    // State label & badge
    let state = 'Normal Level', badgeClass = 'pill-badge green', badgeTxt = 'AUTO ACTIVE';
    if (!isAuto)              { state = 'Manual Override'; badgeClass = 'pill-badge amber'; badgeTxt = 'MANUAL MODE'; }
    if (draining)             { state = '⚠ OVERFLOW DRAINING'; badgeClass = 'pill-badge red'; badgeTxt = 'OVERFLOW!'; }
    else if (level >= fillThreshold) state = 'Fill Target Reached';
    else if (level <= 20)     { state = 'Low — Refilling'; if (isAuto) { badgeClass = 'pill-badge amber'; badgeTxt = 'REFILLING'; } }
    tankStateLabel.textContent  = state;
    autoStatusBadge.className   = badgeClass;
    autoStatusBadge.textContent = badgeTxt;

    // Fluid colour
    if (level >= overflowThreshold)
      fluidContainer.style.background = 'linear-gradient(to top,rgba(180,0,0,0.55),rgba(255,77,77,0.18))';
    else if (level >= fillThreshold)
      fluidContainer.style.background = 'linear-gradient(to top,rgba(0,100,200,0.65),rgba(0,180,255,0.28))';
    else
      fluidContainer.style.background = 'linear-gradient(to top,rgba(0,90,190,0.6),rgba(0,190,255,0.2))';

    // Refill Pump (Inflow Pipe)
    const pumActive = pumpRunning;
    inflowStream.classList.toggle('active', pumActive);
    pumpNodeState.textContent = pumActive ? 'RUNNING' : 'OFF';
    pumpNodeState.className   = `node-status${pumActive ? ' active-open' : ''}`;
    relayBox2.classList.toggle('active', pumActive);
    relayLed2.classList.toggle('on', pumActive);
    pumpTextStatus.textContent = pumActive ? 'RUNNING (REFILL)' : 'OFF';
    pumpTextStatus.className   = `relay-status-text${pumActive ? ' active' : ''}`;
    btnTogglePump.textContent  = pumActive ? 'Stop Pump' : 'Start Pump';

    // Release Solenoid Valve (Outflow Pipe)
    const solActive = solenoidOpen;
    outflowStream.classList.toggle('active', solActive);
    solenoidNodeState.textContent = solActive ? 'OPEN' : 'CLOSED';
    solenoidNodeState.className   = `node-status${solActive ? ' active-drain' : ''}`;
    relayBox1.classList.toggle('active', solActive);
    relayLed1.classList.toggle('on', solActive);
    solenoidTextStatus.textContent = solActive ? 'OPEN (RELEASE)' : 'CLOSED';
    solenoidTextStatus.className   = `relay-status-text${solActive ? ' active' : ''}`;
    btnToggleSolenoid.textContent  = solActive ? 'Close Valve' : 'Open Valve';
  }

  /* ============================================================
     THRESHOLD SYNC — slider ↔ number input ↔ tank guide lines
     ============================================================ */
  function applyFill(v, sendCmd = false) {
    v = Math.min(95, Math.max(40, parseInt(v) || 40));
    fillThreshold = v;
    fillStopSlider.value = v;
    fillStopInput.value  = v;
    fillTagVal.textContent = `${v}%`;
    fillRulerLabel.textContent = `${v}%`;
    fillLineGuide.style.bottom = `${v}%`;
    modeDescFill.textContent = `${v}%`;
    if (sendCmd) sendToESP32(`SETFILL:${v}`);
    updateModeDesc();
  }

  function applyDrain(v, sendCmd = false) {
    v = Math.min(70, Math.max(10, parseInt(v) || 10));
    drainThreshold = v;
    drainTargetSlider.value = v;
    drainTargetInput.value  = v;
    drainTagVal.textContent = `${v}%`;
    drainRulerLabel.textContent = `${v}%`;
    drainLineGuide.style.bottom = `${v}%`;
    modeDescDrain.textContent = `${v}%`;
    if (sendCmd) sendToESP32(`SETDRAIN:${v}`);
    updateModeDesc();
  }

  function applyOverflow(v, sendCmd = false) {
    v = Math.min(98, Math.max(75, parseInt(v) || 82));
    overflowThreshold = v;
    overflowSlider.value = v;
    overflowInput.value  = v;
    overflowTagVal.textContent = `${v}%`;
    overflowRulerLabel.textContent = `${v}%`;
    overflowLineGuide.style.bottom = `${v}%`;
    modeDescOverflow.textContent = `${v}%`;
    if (sendCmd) {
      // ESP32 uses SETOVERFLOW command (add to firmware if needed)
      logTerm(`[LOCAL] Overflow trigger set to ${v}%`, 'sys');
      addActivity(`Overflow threshold changed to ${v}%`, 'warn');
    }
  }

  function applyCapacity(v) {
    v = Math.max(1, parseInt(v) || 50);
    tankCapacity = v;
    tankCapacityInput.value = v;
    capacityBadge.textContent = `${v} L Capacity`;
    addActivity(`Tank capacity updated to ${v} L`, 'ok');
  }

  function updateModeDesc() {
    modeDescFill.textContent     = `${fillThreshold}%`;
    modeDescOverflow.textContent = `${overflowThreshold}%`;
    modeDescDrain.textContent    = `${drainThreshold}%`;
  }

  // Slider ↔ input two-way binding
  fillStopSlider.addEventListener('input', e => applyFill(e.target.value, bleConnected));
  fillStopInput.addEventListener('change', e => applyFill(e.target.value, true));
  fillStopInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyFill(e.target.value, true); });

  drainTargetSlider.addEventListener('input', e => applyDrain(e.target.value, bleConnected));
  drainTargetInput.addEventListener('change', e => applyDrain(e.target.value, true));
  drainTargetInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyDrain(e.target.value, true); });

  overflowSlider.addEventListener('input', e => applyOverflow(e.target.value, bleConnected));
  overflowInput.addEventListener('change', e => applyOverflow(e.target.value, true));
  overflowInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyOverflow(e.target.value, true); });

  tankCapacityInput.addEventListener('change', e => applyCapacity(e.target.value));

  // Apply All button
  $('btnApplyThresholds').addEventListener('click', () => {
    applyFill(fillStopInput.value, true);
    applyDrain(drainTargetInput.value, true);
    applyOverflow(overflowInput.value, true);
    applyCapacity(tankCapacityInput.value);
    logTerm('[CONFIG] All thresholds applied and sent to ESP32.', 'out');
    addActivity(`All thresholds applied: Fill ${fillThreshold}% / Drain ${drainThreshold}% / Overflow ${overflowThreshold}%`, 'ok');
  });

  /* ============================================================
     MODE CONTROLS
     ============================================================ */
  function updateMode(auto) {
    isAuto = auto;
    btnModeAuto.classList.toggle('active', auto);
    btnModeAuto.classList.remove('active-manual');
    btnModeManual.classList.toggle('active', !auto);
    btnModeManual.classList.toggle('active-manual', !auto);
    btnToggleSolenoid.disabled = auto;
    btnTogglePump.disabled = auto;
    updateModeDesc();
    addActivity(`Control mode changed to ${auto ? 'AUTOMATIC' : 'MANUAL OVERRIDE'}`, auto ? 'ok' : 'warn');
  }

  btnModeAuto.addEventListener('click', () => {
    sendToESP32('MODE:AUTO');
    if (!bleConnected) updateMode(true);
  });
  btnModeManual.addEventListener('click', () => {
    sendToESP32('MODE:MANUAL');
    if (!bleConnected) updateMode(false);
  });

  /* ============================================================
     RELAY BUTTONS
     ============================================================ */
  btnToggleSolenoid.addEventListener('click', () => {
    if (!isAuto) sendToESP32(solenoidOpen ? 'SOLENOID:0' : 'SOLENOID:1');
  });
  btnTogglePump.addEventListener('click', () => {
    if (!isAuto) sendToESP32(pumpRunning ? 'PUMP:0' : 'PUMP:1');
  });

  /* ============================================================
     EMERGENCY STOP
     ============================================================ */
  btnEmergencyStop.addEventListener('click', () => {
    solenoidOpen = false;
    pumpRunning  = false;
    draining     = false;
    sendToESP32('SOLENOID:0');
    sendToESP32('PUMP:0');
    logTerm('[EMERGENCY] All relays STOPPED.', 'err');
    addActivity('⛔ EMERGENCY STOP triggered — all relays deactivated', 'err');
    renderUI();
  });

  /* ============================================================
     SIMULATION SLIDER & PRESETS
     ============================================================ */
  waterSimInput.addEventListener('input', e => {
    if (!solenoidOpen && !pumpRunning) level = parseFloat(e.target.value);
  });
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => { waterSimInput.value = btn.dataset.val; waterSimInput.dispatchEvent(new Event('input')); });
  });

  /* ============================================================
     TERMINAL
     ============================================================ */
  terminalForm.addEventListener('submit', e => {
    e.preventDefault();
    const cmd = terminalInput.value.trim();
    if (!cmd) return;
    terminalInput.value = '';
    sendToESP32(cmd);
  });

  document.querySelectorAll('.btn-macro').forEach(btn => {
    btn.addEventListener('click', () => sendToESP32(btn.dataset.cmd));
  });

  /* ============================================================
     COMMAND ROUTER
     ============================================================ */
  function sendToESP32(cmd) {
    if (bleConnected) {
      logTerm(`> ${cmd}`, 'in');
      sendBLE(cmd);
    } else {
      executeLocal(cmd);
    }
  }

  function executeLocal(cmd) {
    const upper = cmd.trim().toUpperCase();
    logTerm(`> ${upper}`, 'in');

    if (upper === 'STATUS') {
      logTerm(`LEVEL:${Math.round(level)}% | VOL:${((level/100)*tankCapacity).toFixed(1)}L | MODE:${isAuto?'AUTO':'MANUAL'} | SOLENOID:${solenoidOpen?'OPEN':'CLOSED'} | PUMP:${pumpRunning?'ON':'OFF'}`, 'out');
    } else if (upper === 'MODE:AUTO' || upper === 'AUTO:1') {
      updateMode(true); logTerm('SUCCESS: Mode → AUTOMATIC', 'out');
    } else if (upper === 'MODE:MANUAL' || upper === 'AUTO:0') {
      updateMode(false); logTerm('SUCCESS: Mode → MANUAL', 'out');
    } else if (upper === 'SOLENOID:1') {
      if (!isAuto) { solenoidOpen = true; logTerm('SUCCESS: Solenoid OPENED', 'out'); }
      else logTerm('ERROR: Switch to MANUAL first', 'err');
    } else if (upper === 'SOLENOID:0') {
      if (!isAuto) {
        solenoidOpen = false;
        if (pumpRunning) pumpRunning = false;
        logTerm('SUCCESS: Solenoid CLOSED', 'out');
      } else logTerm('ERROR: Switch to MANUAL first', 'err');
    } else if (upper === 'PUMP:1') {
      if (!isAuto) {
        pumpRunning = true;
        solenoidOpen = true; // Open valve simultaneously so pump pushes water through
        logTerm('SUCCESS: Pump STARTED & Solenoid OPENED', 'out');
      } else logTerm('ERROR: Switch to MANUAL first', 'err');
    } else if (upper === 'PUMP:0') {
      if (!isAuto) {
        pumpRunning = false;
        solenoidOpen = false; // Close valve when pump stops
        logTerm('SUCCESS: Pump STOPPED & Solenoid CLOSED', 'out');
      } else logTerm('ERROR: Switch to MANUAL first', 'err');
    } else if (upper.startsWith('SETFILL:')) {
      const v = parseInt(upper.slice(8));
      if (v >= 30 && v <= 95) { applyFill(v); logTerm(`SUCCESS: Fill cutoff → ${v}%`, 'out'); }
      else logTerm('ERROR: Fill value must be 30–95', 'err');
    } else if (upper.startsWith('SETDRAIN:')) {
      const v = parseInt(upper.slice(9));
      if (v >= 10 && v < fillThreshold) { applyDrain(v); logTerm(`SUCCESS: Drain target → ${v}%`, 'out'); }
      else logTerm('ERROR: Drain value out of range', 'err');
    } else if (upper === 'HELP') {
      logTerm('COMMANDS: STATUS, MODE:AUTO, MODE:MANUAL, SOLENOID:1, SOLENOID:0, PUMP:1, PUMP:0, SETFILL:<30-95>, SETDRAIN:<10-74>', 'out');
    } else {
      logTerm('UNKNOWN COMMAND. Type HELP.', 'err');
    }
  }

  /* ============================================================
     WEB BLUETOOTH
     ============================================================ */
  btnConnectBLE.addEventListener('click', async () => {
    if (bleConnected) { disconnectBLE(); return; }
    if (!navigator.bluetooth) {
      alert('Web Bluetooth is not supported.\nUse Chrome or Edge on Android/Desktop, or the WebBLE app on iPhone.');
      return;
    }
    try {
      logTerm('[BLE] Scanning for ESP32_WaterMonitor...', 'sys');
      bleDevice = await navigator.bluetooth.requestDevice({ filters: [{ name: 'ESP32_WaterMonitor' }], optionalServices: [SVC_UUID] });
      bleDevice.addEventListener('gattserverdisconnected', onBLEDisconnect);
      const server  = await bleDevice.gatt.connect();
      const service = await server.getPrimaryService(SVC_UUID);
      rxChar = await service.getCharacteristic(RX_UUID);
      txChar = await service.getCharacteristic(TX_UUID);
      await txChar.startNotifications();
      txChar.addEventListener('characteristicvaluechanged', onBLEData);
      bleConnected = true;
      setBLEUI(true);
      logTerm('[BLE] Connected to ESP32_WaterMonitor!', 'out');
      addActivity('Bluetooth hardware connected', 'ok');
      sendBLE('STATUS');
    } catch (e) {
      logTerm(`[BLE ERROR] ${e.message}`, 'err');
    }
  });

  function disconnectBLE() {
    if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
    onBLEDisconnect();
  }
  function onBLEDisconnect() {
    bleConnected = false; rxChar = null; txChar = null;
    setBLEUI(false);
    logTerm('[BLE] Disconnected. Simulator active.', 'sys');
    addActivity('Bluetooth disconnected — simulator mode', 'warn');
  }
  function setBLEUI(connected) {
    bleStatusPill.className = `status-pill ${connected ? 'online' : 'offline'}`;
    bleStatusText.textContent = connected ? 'ESP32 Live' : 'Offline';
    btnConnectBLE.querySelector('span').textContent = connected ? 'Disconnect' : 'Pair ESP32';
    btnConnectBLE.style.background = connected ? 'linear-gradient(135deg,#ff4d4d,#c0392b)' : '';
  }
  function onBLEData(event) {
    const text = new TextDecoder().decode(event.target.value).trim();
    if (!text) return;
    logTerm(`[ESP32] ${text}`, 'in');
    const lvl  = text.match(/LEVEL:(\d+)%/);           if (lvl)  { level = +lvl[1]; waterSimInput.value = level; }
    const mode = text.match(/MODE:(AUTO|MANUAL)/);      if (mode) updateMode(mode[1] === 'AUTO');
    const sol  = text.match(/SOLENOID:(OPEN|CLOSED)/);  if (sol)  solenoidOpen = sol[1] === 'OPEN';
    const pump = text.match(/PUMP:(ON|OFF)/);           if (pump) pumpRunning  = pump[1] === 'ON';
    if (text.includes('[ALERT]')) addActivity(text.replace('[ALERT]', '').trim(), 'warn');
    renderUI();
  }
  async function sendBLE(str) {
    if (!bleConnected || !rxChar) return;
    try { await rxChar.writeValue(new TextEncoder().encode(str + '\n')); }
    catch (e) { logTerm(`[SEND ERR] ${e.message}`, 'err'); }
  }

  /* ============================================================
     ACTIVITY LOG
     ============================================================ */
  function addActivity(msg, type = '') {
    const elapsed = Math.floor((Date.now() - sessionStart) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    const div = document.createElement('div');
    div.className = `activity-entry${type ? ' ' + type : ''}`;
    div.innerHTML = `<span class="entry-time">${h}:${m}:${s}</span><span class="entry-msg">${msg}</span>`;
    activityLog.appendChild(div);
    activityLog.scrollTop = activityLog.scrollHeight;
    while (activityLog.children.length > 60) activityLog.removeChild(activityLog.firstChild);
  }

  btnClearLog.addEventListener('click', () => { activityLog.innerHTML = ''; addActivity('Log cleared', ''); });

  /* ============================================================
     TERMINAL LOG HELPER
     ============================================================ */
  function logTerm(text, type = 'sys') {
    const div = document.createElement('div');
    div.className = `log-line ${type}`;
    div.textContent = text;
    terminalLog.appendChild(div);
    terminalLog.scrollTop = terminalLog.scrollHeight;
    while (terminalLog.children.length > 80) terminalLog.removeChild(terminalLog.firstChild);
  }

  /* ============================================================
     MOBILE NAV
     ============================================================ */
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.target);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  /* ---- INIT ---- */
  applyFill(75);
  applyDrain(50);
  applyOverflow(82);
  updateMode(true);
  renderUI();
});
