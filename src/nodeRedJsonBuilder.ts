import { FlowConfig, PathPreference } from "./types";

export function generateNodeRedJson(config: FlowConfig, pathPreference: PathPreference): string {
  // Generate IDs for node configuration which resembles actual Node-RED IDs
  const tabId = "tab_wallbox_pulsar_max";
  const haServerId = "server_ha_config";
  const mqttBrokerId = "broker_mqtt_config";

  const flow: any[] = [
    // ----------------------------------------------------
    // CONFIG NODES
    // ----------------------------------------------------
    {
      id: tabId,
      type: "tab",
      label: "Wallbox Pulsar Max Dual-Path Controller",
      disabled: false,
      info: "Flusso professionale a doppia ridondanza (API + MQTT) per la gestione intelligente della Wallbox Pulsar Max con ricarica solare (ECO) o Manuale.",
    },
    {
      id: haServerId,
      type: "server",
      name: "Home Assistant",
      version: 5,
      addon: true,
      rejectUnauthorizedCerts: true,
      ha_boolean: "y|yes|true|on|home|occupied",
      connectionDelay: true,
      cacheJson: true,
      heartbeat: true,
      heartbeatInterval: 30,
      areaSelector: "friendlyName",
      deviceSelector: "friendlyName",
      entitySelector: "friendlyName",
      statusSeparator: "at: ",
      statusYear: "hidden",
      statusMonth: "short",
      statusDay: "numeric",
      statusHour: "2-digit",
      statusMinute: "2-digit",
    },
    {
      id: mqttBrokerId,
      type: "mqtt-broker",
      name: "Broker Mosquitto MQTT Local",
      broker: config.mqttBrokerHost,
      port: config.mqttBrokerPort.toString(),
      clientid: "node_red_wallbox_controller",
      autoConnect: true,
      usetls: false,
      compatmode: false,
      protocolVersion: "4",
      keepalive: "60",
      cleansession: true,
      birthTopic: "wallbox/controller/status",
      birthQos: "0",
      birthPayload: "online",
      closeTopic: "wallbox/controller/status",
      closeQos: "0",
      closePayload: "offline",
      willTopic: "wallbox/controller/status",
      willQos: "0",
      willPayload: "offline",
    },

    // ----------------------------------------------------
    // FLOWFUSE NODE-RED DASHBOARD 2.0 CONFIG
    // ----------------------------------------------------
    {
      id: "ui-base-main",
      type: "ui-base",
      name: "Wallbox Dashboard",
      path: "/dashboard",
      includeClientData: true,
      showPin: false,
    },
    {
      id: "ui-theme-main",
      type: "ui-theme",
      name: "Pulsar Dark Theme",
      colors: {
        primary: "#0ea5e9",
        bgPage: "#0b1329",
        bgSurface: "#111827",
        text: "#ffffff"
      }
    },
    {
      id: "ui-page-main",
      type: "ui-page",
      name: "Wallbox Pulsar Max",
      icon: "car-electric",
      order: 1,
      base: "ui-base-main",
      theme: "ui-theme-main",
      visible: true,
      disabled: false,
    },
    {
      id: "ui-group-controls",
      type: "ui-group",
      name: "Comandi e Impostazioni ricarica",
      page: "ui-page-main",
      order: 1,
      width: "6",
      height: "1",
      showTitle: true,
      visible: true,
      disabled: false,
    },
    {
      id: "ui-group-status",
      type: "ui-group",
      name: "Stato Potenza & Grafici",
      page: "ui-page-main",
      order: 2,
      width: "6",
      height: "1",
      showTitle: true,
      visible: true,
      disabled: false,
    },

    // ----------------------------------------------------
    // INJECTS / TRIGGER STATE SENSORS
    // ----------------------------------------------------
    {
      id: "node_solar_sensor",
      type: "server-state-changed",
      z: tabId,
      name: "Solar Power Sensor",
      server: haServerId,
      version: 5,
      outputs: 1,
      exposeAsEntityConfig: "",
      entityId: config.solarPowerEntity,
      entityIdType: "exact",
      outputInitially: true,
      stateType: "num",
      ifState: "",
      ifStateType: "str",
      ifStateOperator: "is",
      outputOnlyOnStateChange: true,
      for: "0",
      forType: "str",
      forUnits: "minutes",
      ignorePrevStateNull: true,
      ignorePrevStateUnknown: true,
      ignorePrevStateUnavailable: true,
      outputProperties: [
        { property: "payload", propertyType: "msg", value: "", valueType: "entityState" },
        { property: "data", propertyType: "msg", value: "", valueType: "eventData" },
      ],
      x: 140,
      y: 120,
      wires: [["node_calc_reduction", "ui-solar-text", "ui-chart-format-solar"]],
    },
    {
      id: "node_house_sensor",
      type: "server-state-changed",
      z: tabId,
      name: "House Consumption Sensor",
      server: haServerId,
      version: 5,
      outputs: 1,
      exposeAsEntityConfig: "",
      entityId: config.houseConsumptionEntity,
      entityIdType: "exact",
      outputInitially: true,
      stateType: "num",
      ifState: "",
      ifStateType: "str",
      ifStateOperator: "is",
      outputOnlyOnStateChange: true,
      for: "0",
      forType: "str",
      forUnits: "minutes",
      ignorePrevStateNull: true,
      ignorePrevStateUnknown: true,
      ignorePrevStateUnavailable: true,
      outputProperties: [
        { property: "payload", propertyType: "msg", value: "", valueType: "entityState" },
        { property: "data", propertyType: "msg", value: "", valueType: "eventData" },
      ],
      x: 140,
      y: 200,
      wires: [["node_calc_reduction", "ui-house-text", "ui-chart-format-house"]],
    },

    // ----------------------------------------------------
    // LOGICAL PROCESSING NODES
    // ----------------------------------------------------
    {
      id: "node_calc_reduction",
      type: "function",
      z: tabId,
      name: "Calc & Smooth Surplus PV",
      func: `// Inizializza array per la media mobile nella memoria globale dello script
let samples = context.get('solar_samples') || [];
const maxSamples = ${config.sampleWindow}; // Campioni: finestra configurata di ${config.sampleWindow}

// Ottieni i valori attuali delle letture
let solarPower = 0;
let houseConsumption = 0;

if (msg.topic === "${config.solarPowerEntity}") {
    solarPower = parseFloat(msg.payload) || 0;
    houseConsumption = context.get('last_consumption') || 0;
    context.set('last_solar', solarPower);
} else {
    houseConsumption = parseFloat(msg.payload) || 0;
    solarPower = context.get('last_solar') || 0;
    context.set('last_consumption', houseConsumption);
}

// Surplus istantaneo
let rawSurplus = solarPower - houseConsumption;
msg.rawSurplus = rawSurplus;

// Aggiungi campione ed esegui smoothing
samples.push(rawSurplus);
if (samples.length > maxSamples) {
    samples.shift(); // Rimuovi il più vecchio
}
context.set('solar_samples', samples);

// Calcolo della media mobile
let sum = samples.reduce((a, b) => a + b, 0);
let smoothedSurplus = sum / samples.length;

msg.payload = smoothedSurplus;
msg.topic = "smoothed_surplus";
return msg;`,
      outputs: 1,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 440,
      y: 160,
      wires: [["node_decide_current"]],
    },
    {
      id: "node_decide_current",
      type: "function",
      z: tabId,
      name: "ECO (PV) / Manual Decision",
      func: `// Determina la modalità attiva (letta dallo stato o memorizzata in flow context)
let chargingMode = flow.get('wallbox_mode') || 'ECO'; // ECO, MANUALE, OFF
let manualLimit = flow.get('wallbox_manual_current') || 10; // Ampere manuali impostati
let isPlugged = flow.get('wallbox_is_plugged') || true;

if (chargingMode === "OFF") {
    msg.action = "PAUSE";
    msg.ampere = 0;
    msg.payload = "stop";
    return msg;
}

if (chargingMode === "MANUALE") {
    msg.action = "START";
    msg.ampere = Math.max(${config.minChargeCurrent}, Math.min(manualLimit, ${config.maxChargeCurrent}));
    msg.payload = "manual_charge";
    return msg; 
}

// --- LOGICA ECO (Surplus Solare) ---
let smoothedSurplusWatts = parseFloat(msg.payload) || 0;

// Formula: Corrente (A) = Surplus (W) / (Volt * Fasi)
const singlePhaseVolts = ${config.singlePhaseVoltage};
let calculatedAmpere = Math.floor(smoothedSurplusWatts / singlePhaseVolts);

let targetAmpere = 0;
let action = "PAUSE";

if (smoothedSurplusWatts >= ${config.startThresholdWatts}) {
    // Abbiamo abbastanza energia per avviare
    targetAmpere = Math.max(${config.minChargeCurrent}, Math.min(calculatedAmpere, ${config.maxChargeCurrent}));
    action = "START";
} else if (smoothedSurplusWatts < ${config.stopThresholdWatts}) {
    // Scarsa energia solare, spegniamo la ricarica
    targetAmpere = 0;
    action = "PAUSE";
} else {
    // Isteresi intermedia: se era attiva manteniamo il minimo di ricarica
    let lastState = flow.get('wallbox_active_state') || "PAUSE";
    if (lastState === "START") {
        targetAmpere = ${config.minChargeCurrent};
        action = "START";
    } else {
        targetAmpere = 0;
        action = "PAUSE";
    }
}

msg.action = action;
msg.ampere = targetAmpere;
msg.payload = action === "START" ? "charging_solar" : "solar_paused";

return msg;`,
      outputs: 1,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 720,
      y: 160,
      wires: [["node_hysteresis_check"]],
    },
    {
      id: "node_hysteresis_check",
      type: "function",
      z: tabId,
      name: "Hysteresis Limits & Rate Limit",
      func: `// Verifica che non vengano inviati comandi troppi frequenti per salvaguardare le API e i contattori
let lastUpdateTime = flow.get('wallbox_last_update_time') || 0;
let lastAmpereValue = flow.get('wallbox_last_ampere') || 0;
let lastActionValue = flow.get('wallbox_last_action') || "PAUSE";

let now = Math.floor(Date.now() / 1000); // Unix secondi
let secondsSinceUpdate = now - lastUpdateTime;
const cooldownPeriod = ${config.hysteresisSeconds}; // ${config.hysteresisSeconds} secondi di cooldown

// Sblocca forzatamente se c'è un arresto di emergenza o un cambio radicale
let overrideChange = (msg.action === "PAUSE" && lastActionValue === "START");

if (secondsSinceUpdate < cooldownPeriod && !overrideChange) {
    if (msg.ampere === lastAmpereValue && msg.action === lastActionValue) {
        // Nessuna modifica rilevata, ignora silenziosamente
        return null;
    }
    // Comando variato ma dentro l'intervallo di sicurezza: frena!
    node.status({fill:"yellow",shape:"ring",text: "Ignorato: anti-rimbalzo attivo (" + secondsSinceUpdate + "s/" + cooldownPeriod + "s)"});
    return null;
}

// Aggiorna stato locale per la prossima iterazione
flow.set('wallbox_last_update_time', now);
flow.set('wallbox_last_ampere', msg.ampere);
flow.set('wallbox_last_action', msg.action);
flow.set('wallbox_active_state', msg.action);

node.status({fill:"green",shape:"dot",text: "Inviato: " + msg.action + " / " + msg.ampere + "A"});
return msg;`,
      outputs: 1,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 980,
      y: 160,
      wires: [["node_routing_switch", "ui-charge-status", "ui-extract-amps"]],
    },

    // ----------------------------------------------------
    // ROUTING SWITCH (API preferred vs MQTT backup)
    // ----------------------------------------------------
    {
      id: "node_routing_switch",
      type: "function",
      z: tabId,
      name: "Routing Switch: Dual-Path",
      func: `// Carica la preferenza di instradamento (configurabile dall'utente)
// Valori possibili: "API", "MQTT", "PARALLELO"
let pathPreference = "${pathPreference}"; 

// Prepariamo 2 messaggi separati per le due uscite
// Uscita 1: Home Assistant API
// Uscita 2: MQTT Broker Local
let apiMsg = null;
let mqttMsg = null;

if (pathPreference === "API" || pathPreference === "PARALLELO") {
    apiMsg = RED.util.cloneMessage(msg);
    apiMsg.topic = "api_command";
}

if (pathPreference === "MQTT" || pathPreference === "PARALLELO") {
    mqttMsg = RED.util.cloneMessage(msg);
    mqttMsg.topic = "mqtt_command";
}

// Logica per testare il backup o segnalare lo stato attuale
node.status({
    fill: "blue", 
    shape: "dot", 
    text: "Instradamento: " + pathPreference
});

return [apiMsg, mqttMsg];`,
      outputs: 2,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 1220,
      y: 220,
      wires: [["node_ha_api_adapter"], ["node_mqtt_adapter"]],
    },

    // ----------------------------------------------------
    // ADAPTERS (Translates payloads to Home Assistant services or MQTT Topics)
    // ----------------------------------------------------
    {
      id: "node_ha_api_adapter",
      type: "function",
      z: tabId,
      name: "HA API Adapter",
      func: `// Genera i messaggi formattati per i nodi call-service di Home Assistant
let isCharging = (msg.action === "START");

// Messaggio 1: Cambia la potenza di carica in Ampere
let currentMsg = {
    payload: {
        entity_id: "${config.chargerControlEntity}",
        value: msg.ampere
    },
    topic: "set_current"
};

// Messaggio 2: Start / Stop o Pausa ricarica
let stateMsg = {
    payload: {
        entity_id: "${config.pauseEntity}"
    },
    topic: isCharging ? "turn_on" : "turn_off"
};

// Inviamo i due comandi in cascata alle API di Home Assistant
return [[currentMsg, stateMsg]];`,
      outputs: 1,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 1420,
      y: 180,
      wires: [["node_ha_call_service_current"]],
    },
    {
      id: "node_mqtt_adapter",
      type: "function",
      z: tabId,
      name: "MQTT Payload Adapter",
      func: `// Genera i payload nativi per il broker MQTT per essere letti dalla Wallbox Pulsar Max
let isCharging = (msg.action === "START");

// Messaggio 1: Potenza in Ampere
let currentMsg = {
    topic: "${config.mqttCurrentSetTopic}",
    payload: msg.ampere,
    qos: 1,
    retain: true
};

// Messaggio 2: Pausa o Avvio (normalmente 1 = ricarica attiva, 0 = in pausa)
let pauseMsg = {
    topic: "${config.mqttPauseSetTopic}",
    payload: isCharging ? "0" : "1", // 0 = non in pausa (in carica), 1 = in pausa
    qos: 1,
    retain: true
};

return [[currentMsg, pauseMsg]];`,
      outputs: 1,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 1420,
      y: 260,
      wires: [["node_mqtt_out_current"]],
    },

    // ----------------------------------------------------
    // OUTPUT EXECUTION NODES
    // ----------------------------------------------------
    {
      id: "node_ha_call_service_current",
      type: "api-call-service",
      z: tabId,
      name: "HA Call Service API",
      server: haServerId,
      version: 5,
      debugenabled: false,
      domain: "number",
      service: "set_value",
      action: "number.set_value",
      areaId: [],
      deviceId: [],
      entityId: ["{{payload.entity_id}}"],
      data: "{\"value\": {{payload.value}} }",
      dataType: "json",
      mergeContext: "",
      mustacheAltTags: false,
      outputProperties: [],
      queue: "none",
      x: 1610,
      y: 180,
      wires: [[]],
    },
    {
      id: "node_mqtt_out_current",
      type: "mqtt out",
      z: tabId,
      name: "MQTT Publish Wallbox",
      topic: "",
      qos: "1",
      retain: "true",
      broker: mqttBrokerId,
      x: 1610,
      y: 260,
      wires: [],
    },

    // ----------------------------------------------------
    // LOCK/UNLOCK FLOW (INDEPENDENT TRIGGER)
    // ----------------------------------------------------
    {
      id: "node_ui_lock_button",
      type: "inject",
      z: tabId,
      name: "Manual Lock/Unlock Toggle",
      props: [
        { p: "payload", v: "toggle", vt: "str" },
      ],
      repeat: "",
      crontab: "",
      once: false,
      onceDelay: 0.1,
      x: 150,
      y: 520,
      wires: [["node_lock_routing"]],
    },
    {
      id: "node_lock_routing",
      type: "function",
      z: tabId,
      name: "Lock Routing / Dual-Path",
      func: `// Recupera lo stato attuale del blocco
let lastLockedState = flow.get('wallbox_locked_state') || false;
let nextState = !lastLockedState;
flow.set('wallbox_locked_state', nextState);

let pathPreference = "${pathPreference}"; 
let apiMsg = null;
let mqttMsg = null;

if (pathPreference === "API" || pathPreference === "PARALLELO") {
    // Comando lock/unlock per HA
    apiMsg = {
        payload: {
            entity_id: "${config.lockEntity}"
        },
        topic: nextState ? "lock" : "unlock"
    };
}

if (pathPreference === "MQTT" || pathPreference === "PARALLELO") {
    // Topic: wallbox/set/lock -> "1" (lock) o "0" (unlock)
    mqttMsg = {
        topic: "${config.mqttLockSetTopic}",
        payload: nextState ? "1" : "0",
        qos: 1,
        retain: true
    };
}

return [apiMsg, mqttMsg];`,
      outputs: 2,
      noerr: 0,
      initialize: "",
      finalize: "",
      libs: [],
      x: 440,
      y: 480,
      wires: [["node_ha_lock_service"], ["node_mqtt_lock_publish"]],
    },
    {
      id: "node_ha_lock_service",
      type: "api-call-service",
      z: tabId,
      name: "HA Lock Service API",
      server: haServerId,
      version: 5,
      debugenabled: false,
      domain: "lock",
      service: "{{topic}}", // si adatta a 'lock' o 'unlock'
      action: "lock.{{topic}}",
      areaId: [],
      deviceId: [],
      entityId: ["{{payload.entity_id}}"],
      data: "{}",
      dataType: "json",
      mergeContext: "",
      mustacheAltTags: false,
      outputProperties: [],
      queue: "none",
      x: 740,
      y: 460,
      wires: [[]],
    },
    {
      id: "node_mqtt_lock_publish",
      type: "mqtt out",
      z: tabId,
      name: "MQTT Publish Lock",
      topic: "",
      qos: "1",
      retain: "true",
      broker: mqttBrokerId,
      x: 740,
      y: 504,
      wires: [],
    },

    // ----------------------------------------------------
    // INTERACTIVE DASHBOARD INPUT NODES (CONTROLS)
    // ----------------------------------------------------
    {
      id: "ui-mode-select",
      type: "ui-dropdown",
      z: tabId,
      name: "Seleziona Modalità ricarica",
      label: "Modalità Ricarica",
      tooltip: "Scegli l'algoritmo di funzionamento della Wallbox",
      place: "Seleziona...",
      group: "ui-group-controls",
      order: 1,
      width: 0,
      height: 0,
      passthru: true,
      multiple: false,
      options: [
        { label: "Eco (Surplus Solare)", value: "ECO", type: "str" },
        { label: "Manuale (Ampere fissi)", value: "MANUALE", type: "str" },
        { label: "Arresto Forzato (OFF)", value: "OFF", type: "str" }
      ],
      payload: "",
      topic: "mode",
      topicType: "str",
      x: 150,
      y: 340,
      wires: [["ui-store-mode"]],
    },
    {
      id: "ui-store-mode",
      type: "change",
      z: tabId,
      name: "Salva Modalità in Flow",
      rules: [
        { t: "set", p: "wallbox_mode", pt: "flow", to: "payload", tot: "msg" }
      ],
      action: "",
      property: "",
      from: "",
      to: "",
      reg: false,
      x: 400,
      y: 340,
      wires: [["node_decide_current"]],
    },
    {
      id: "ui-manual-current-slider",
      type: "ui-slider",
      z: tabId,
      name: "Imposta Corrente Manuale",
      label: "Corrente Manuale (A)",
      tooltip: "Regola l'intensità in modalità Manuale",
      group: "ui-group-controls",
      order: 2,
      width: 0,
      height: 0,
      passthru: true,
      topic: "manual_current",
      topicType: "str",
      min: config.minChargeCurrent,
      max: config.maxChargeCurrent,
      step: 1,
      x: 170,
      y: 400,
      wires: [["ui-store-current"]],
    },
    {
      id: "ui-store-current",
      type: "change",
      z: tabId,
      name: "Salva Limite Ampere in Flow",
      rules: [
        { t: "set", p: "wallbox_manual_current", pt: "flow", to: "payload", tot: "msg" }
      ],
      action: "",
      property: "",
      from: "",
      to: "",
      reg: false,
      x: 420,
      y: 400,
      wires: [["node_decide_current"]],
    },
    {
      id: "ui-lock-switch",
      type: "ui-switch",
      z: tabId,
      name: "Switch Blocco UI",
      label: "Blocco Fisico Wallbox",
      tooltip: "Attiva o disattiva il blocco di sicurezza",
      group: "ui-group-controls",
      order: 3,
      width: 0,
      height: 0,
      passthru: true,
      decouple: "false",
      topic: "lock_state",
      topicType: "str",
      style: "",
      onvalue: "true",
      onvalueType: "bool",
      onicon: "",
      oncolor: "",
      offvalue: "false",
      offvalueType: "bool",
      officon: "",
      offcolor: "",
      x: 130,
      y: 460,
      wires: [["ui-store-lock"]],
    },
    {
      id: "ui-store-lock",
      type: "change",
      z: tabId,
      name: "Salva Stato Blocco",
      rules: [
        { t: "set", p: "wallbox_locked_state", pt: "flow", to: "payload", tot: "msg" }
      ],
      action: "",
      property: "",
      from: "",
      to: "",
      reg: false,
      x: 360,
      y: 460,
      wires: [["node_lock_routing"]],
    },

    // ----------------------------------------------------
    // DASHBOARD INDICATORS & CHART NODES
    // ----------------------------------------------------
    {
      id: "ui-solar-text",
      type: "ui-text",
      z: tabId,
      group: "ui-group-status",
      order: 1,
      width: 0,
      height: 0,
      name: "Visualizzazione Solare LIVE",
      label: "Produzione Fotovoltaico",
      format: "{{msg.payload}} W",
      layout: "row-spread",
      className: "",
      x: 430,
      y: 80,
      wires: [],
    },
    {
      id: "ui-house-text",
      type: "ui-text",
      z: tabId,
      group: "ui-group-status",
      order: 2,
      width: 0,
      height: 0,
      name: "Visualizzazione Casa LIVE",
      label: "Fabbisogno Domestico",
      format: "{{msg.payload}} W",
      layout: "row-spread",
      className: "",
      x: 430,
      y: 240,
      wires: [],
    },
    {
      id: "ui-charge-status",
      type: "ui-text",
      z: tabId,
      group: "ui-group-status",
      order: 3,
      width: 0,
      height: 0,
      name: "Visualizzazione Stato Ricarica UI",
      label: "Azione Controller (ECO/Manual)",
      format: "{{msg.action}} @ {{msg.ampere}}A",
      layout: "row-spread",
      className: "",
      x: 1250,
      y: 80,
      wires: [],
    },
    {
      id: "ui-extract-amps",
      type: "change",
      z: tabId,
      name: "Estrai Ampere Ricarica",
      rules: [
        { t: "set", p: "payload", pt: "msg", to: "ampere", tot: "msg" }
      ],
      action: "",
      property: "",
      from: "",
      to: "",
      reg: false,
      x: 1250,
      y: 130,
      wires: [["ui-charge-gauge"]],
    },
    {
      id: "ui-charge-gauge",
      type: "ui-gauge",
      z: tabId,
      name: "Indicatore Corrente Carica",
      group: "ui-group-status",
      order: 4,
      width: 0,
      height: 0,
      gtype: "gage",
      title: "Corrente Erogata Wallbox",
      label: "Ampere",
      format: "{{value}} A",
      min: 0,
      max: config.maxChargeCurrent,
      colors: ["#38bdf8", "#0ea5e9", "#0284c7"],
      segments: [
        {
          from: 0,
          color: "#38bdf8"
        },
        {
          from: Math.floor(config.maxChargeCurrent * 0.4),
          color: "#0ea5e9"
        },
        {
          from: Math.floor(config.maxChargeCurrent * 0.8),
          color: "#0284c7"
        }
      ],
      seg1: "",
      seg2: "",
      className: "",
      x: 1470,
      y: 130,
      wires: [],
    },
    {
      id: "ui-chart-format-solar",
      type: "change",
      z: tabId,
      name: "Topic Fotovoltaico per Grafico",
      rules: [
        { t: "set", p: "topic", pt: "msg", to: "Produzione Fotovoltaico (W)", tot: "str" }
      ],
      action: "",
      property: "",
      from: "",
      to: "",
      reg: false,
      x: 440,
      y: 120,
      wires: [["ui-power-chart"]],
    },
    {
      id: "ui-chart-format-house",
      type: "change",
      z: tabId,
      name: "Topic Carico Casa per Grafico",
      rules: [
        { t: "set", p: "topic", pt: "msg", to: "Carico Casa (W)", tot: "str" }
      ],
      action: "",
      property: "",
      from: "",
      to: "",
      reg: false,
      x: 440,
      y: 200,
      wires: [["ui-power-chart"]],
    },
    {
      id: "ui-power-chart",
      type: "ui-chart",
      z: tabId,
      group: "ui-group-status",
      order: 5,
      width: "6",
      height: "4",
      label: "Bilancio Energetico (W)",
      chartType: "line",
      legend: "true",
      xformat: "HH:mm:ss",
      interpolate: "linear",
      nodata: "In attesa di dati...",
      dot: false,
      ymin: "",
      ymax: "",
      removeOlder: "1",
      removeOlderPoints: "",
      removeOlderUnit: "3600",
      cutout: 0,
      useOneColor: false,
      colors: ["#fbbf24", "#6366f1", "#0ea5e9"],
      outputs: 1,
      useDifferentColor: false,
      className: "",
      x: 740,
      y: 220,
      wires: [[]],
    }
  ];

  return JSON.stringify(flow, null, 2);
}
