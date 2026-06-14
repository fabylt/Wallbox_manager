import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  Sliders,
  Cpu,
  Settings,
  BookOpen,
  MessageSquare,
  Copy,
  Check,
  RefreshCw,
  Wifi,
  WifiOff,
  Database,
  CloudSun,
  Lock,
  Unlock,
  AlertTriangle,
  Send,
  Zap,
  Info,
  ChevronRight,
  TrendingUp
} from "lucide-react";
import { FlowConfig, RedNode, RedEdge, SimLog, SimulationState, FlowMode, PathPreference } from "./types";
import { generateNodeRedJson } from "./nodeRedJsonBuilder";

const INITIAL_CONFIG: FlowConfig = {
  haUrl: "http://homeassistant.local:8123",
  chargerStatusEntity: "sensor.wallbox_pulsar_max_status",
  chargerControlEntity: "number.wallbox_pulsar_max_charging_current",
  lockEntity: "lock.wallbox_pulsar_max_locked",
  pauseEntity: "switch.wallbox_pulsar_max_pause_resume",
  solarPowerEntity: "sensor.power_meter_solar_production",
  houseConsumptionEntity: "sensor.power_meter_house_consumption",
  mqttBrokerHost: "192.168.1.100",
  mqttBrokerPort: 1883,
  mqttStatusTopic: "wallbox/status",
  mqttCurrentSetTopic: "wallbox/set/current",
  mqttLockSetTopic: "wallbox/set/lock",
  mqttPauseSetTopic: "wallbox/set/pause",
  sampleWindow: 5,
  hysteresisSeconds: 300,
  minChargeCurrent: 6,
  maxChargeCurrent: 16,
  pvMultiplier: 1,
  singlePhaseVoltage: 230,
  startThresholdWatts: 1380, // 6A * 230V
  stopThresholdWatts: 500,
};

export default function App() {
  // Tabs: dashboard, node-red, setup, json, guide
  const [activeTab, setActiveTab] = useState<"dashboard" | "node-red" | "setup" | "json" | "guide">("dashboard");

  // Configuration Setup
  const [config, setConfig] = useState<FlowConfig>(INITIAL_CONFIG);

  // Simulation parameters & inputs
  const [simInputSolar, setSimInputSolar] = useState<number>(3500); // Watt generated
  const [simInputHouse, setSimInputHouse] = useState<number>(800); // House consumption
  const [simChargingMode, setSimChargingMode] = useState<FlowMode>("ECO");
  const [simPathPref, setSimPathPref] = useState<PathPreference>("PARALLELO");
  const [simManualCurrent, setSimManualCurrent] = useState<number>(10); // Ampere
  const [isPluggedIn, setIsPluggedIn] = useState<boolean>(true);
  const [simBatteryPercent, setSimBatteryPercent] = useState<number>(42);

  // Fail/Status Simulations
  const [apiOnline, setApiOnline] = useState<boolean>(true);
  const [mqttOnline, setMqttOnline] = useState<boolean>(true);
  const [oscillateWeather, setOscillateWeather] = useState<boolean>(false);

  // Simulated Core State (Computed in effect)
  const [systemState, setSystemState] = useState<SimulationState>({
    solarPower: 3500,
    houseConsumption: 800,
    chargingMode: "ECO",
    pathPreference: "PARALLELO",
    manualCurrent: 10,
    isPluggedIn: true,
    batteryPercent: 42,
    chargerLocked: false,
    chargerCharging: false,
    chargerCurrent: 0,
    rawSurplus: 2700,
    smoothedSurplus: 2700,
    lastSurplusSamples: [2700, 2700, 2700, 2700, 2700],
    secondsSinceLastChange: 350, // More than hysteresis
    apiStatus: "ONLINE",
    mqttStatus: "ONLINE"
  });

  // History tracking for scrolling chart
  const [historyChart, setHistoryChart] = useState<Array<{
    time: string;
    solar: number;
    house: number;
    surplus: number;
    smoothed: number;
    chargeAmps: number;
  }>>([]);

  // Node-RED visual nodes representation
  const [selectedNode, setSelectedNode] = useState<string | null>("node_calc_reduction");
  const [payloadTriggerState, setPayloadTriggerState] = useState<number>(0); // Flips to animate signals

  // Simulation Logs
  const [logs, setLogs] = useState<SimLog[]>([]);

  // AI Chat Consultant State
  const [chatInput, setChatInput] = useState<string>("");
  const [chatMessages, setChatMessages] = useState<Array<{ sender: "user" | "ai"; text: string }>>([
    {
      sender: "ai",
      text: "Ciao! Sono il tuo Consulente Esperto di Home Assistant e Node-RED. Chiedimi qualunque cosa sull'integrazione della tua Wallbox Pulsar Max con architettura a doppia ridondanza (API + MQTT), sulla gestione del surplus fotovoltaico, sulla configurazione di Mosquitto Broker o su problemi di rate-limit con il cloud Wallbox!",
    },
  ]);
  const [chatLoading, setChatLoading] = useState<boolean>(false);

  const [copiedCode, setCopiedCode] = useState<boolean>(false);

  // Oscillating weather reference
  const weatherTimerRef = useRef<NodeJS.Timeout | null>(null);
  const historyTimerRef = useRef<NodeJS.Timeout | null>(null);
  const coreTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Ref to chat message end
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize Logs with welcome messages
  useEffect(() => {
    addLog("System", "Inizializzazione flussi completata. Configurazione Doppia Ridondanza attiva.", "success", {
      api: INITIAL_CONFIG.haUrl,
      mqtt: `${INITIAL_CONFIG.mqttBrokerHost}:${INITIAL_CONFIG.mqttBrokerPort}`
    });
    addLog("MQTT", "Connesso al broker Mosquitto.", "mqtt", "online");
    addLog("HA API", "Integrazione ufficiale Home Assistant connessa.", "api", "connected");

    // Populate chart history values to display a nice starting screen
    const initialHist = [];
    const baseTime = new Date();
    for (let i = 15; i >= 0; i--) {
      const timeStr = new Date(baseTime.getTime() - i * 5000).toLocaleTimeString("it-IT", { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      initialHist.push({
        time: timeStr,
        solar: 3000 + Math.sin(i) * 300,
        house: 700 + Math.random() * 100,
        surplus: 2300,
        smoothed: 2300,
        chargeAmps: 10
      });
    }
    setHistoryChart(initialHist);
  }, []);

  // Scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Weather oscillation simulator effect
  useEffect(() => {
    if (oscillateWeather) {
      addLog("Sensore FV", "Modalità meteo variabile attivata. Simulazione nuvole in corso...", "warning", null);
      let step = 0;
      weatherTimerRef.current = setInterval(() => {
        step += 1;
        // Alternate solar production wildly to show off smoothing
        let pSolar = 3500;
        if (step % 4 === 1) {
          pSolar = 900; // Cloud covers solar completely
          addLog("Sensore FV", "Copertura nuvolosa intensa improvvisa! Produzione crolla a 900W.", "warning", 900);
        } else if (step % 4 === 2) {
          pSolar = 1500; // Cloud partially clearing
          addLog("Sensore FV", "Diradamento nuvole parziale. Produzione a 1500W.", "info", 1500);
        } else if (step % 4 === 3) {
          pSolar = 4800; // Bright sun burst
          addLog("Sensore FV", "Picco di soleggiamento! Produzione sale a 4800W.", "success", 4800);
        } else {
          pSolar = 3200; // Back to normal
          addLog("Sensore FV", "Condizione solare stabile. Produzione a 3200W.", "info", 3200);
        }
        setSimInputSolar(pSolar);
      }, 7000);
    } else {
      if (weatherTimerRef.current) {
        clearInterval(weatherTimerRef.current);
        addLog("Sensore FV", "Simulazione meteo disattivata.", "info", null);
      }
    }
    return () => {
      if (weatherTimerRef.current) clearInterval(weatherTimerRef.current);
    };
  }, [oscillateWeather]);

  // Log auxiliary function
  const addLog = (nodeLabel: string, message: string, type: "info" | "api" | "mqtt" | "warning" | "success" = "info", payload: any = null) => {
    const newLog: SimLog = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString("it-IT", { hour12: false }),
      nodeLabel,
      message,
      type,
      payload
    };
    setLogs((prev) => [newLog, ...prev.slice(0, 50)]);
  };

  // Run the Core Controller Simulator Loop
  useEffect(() => {
    coreTimerRef.current = setInterval(() => {
      setSystemState((prev) => {
        // 1. Calculate raw surplus
        const rawSurplus = simInputSolar - simInputHouse;

        // 2. Add sample to moving average list
        let samples = [...prev.lastSurplusSamples];
        samples.push(rawSurplus);
        if (samples.length > config.sampleWindow) {
          samples.shift();
        }

        // 3. Compute smoothed surplus (Moving Average)
        const sum = samples.reduce((a, b) => a + b, 0);
        const smoothedSurplus = parseFloat((sum / samples.length).toFixed(1));

        // Let's determine the charging decision based on rules and Mode
        let targetCurrent = 0;
        let isCharging = false;
        let actionMsg = "PAUSE";
        let detailMsg = "";

        // Seconds counter since last change
        let nextSeconds = prev.secondsSinceLastChange + 2; // Simulation steps 2 seconds, increment counter

        if (!isPluggedIn) {
          targetCurrent = 0;
          isCharging = false;
          actionMsg = "PAUSE";
          detailMsg = "Veicolo scollegato. Stacco immediato.";
        } else if (simChargingMode === "OFF") {
          targetCurrent = 0;
          isCharging = false;
          actionMsg = "PAUSE";
          detailMsg = "Impianto spento manualmente (OFF).";
        } else if (simChargingMode === "MANUALE") {
          actionMsg = "START";
          targetCurrent = Math.max(config.minChargeCurrent, Math.min(simManualCurrent, config.maxChargeCurrent));
          isCharging = true;
          detailMsg = `Modalità manuale attiva. Intensità: ${targetCurrent}A.`;
        } else {
          // ECO SOLAR CHARGING
          // Voltages and phase configurations
          const chargeStartWatts = config.startThresholdWatts;
          const chargeStopWatts = config.stopThresholdWatts;
          const volts = config.singlePhaseVoltage;

          // Calculated current Ampere = surplus / volt
          const calculatedAmps = Math.floor(smoothedSurplus / volts);

          // Hysteresis rules
          if (smoothedSurplus >= chargeStartWatts) {
            targetCurrent = Math.max(config.minChargeCurrent, Math.min(calculatedAmps, config.maxChargeCurrent));
            isCharging = true;
            actionMsg = "START";
            detailMsg = `Surplus FV sufficiente (${smoothedSurplus}W). Ricarica impostata @ ${targetCurrent} A.`;
          } else if (smoothedSurplus < chargeStopWatts) {
            targetCurrent = 0;
            isCharging = false;
            actionMsg = "PAUSE";
            detailMsg = `Surplus insufficiente (${smoothedSurplus}W). Carica in pausa.`;
          } else {
            // Keep previous action (Hysteresis intermediate zone)
            if (prev.chargerCharging) {
              targetCurrent = config.minChargeCurrent;
              isCharging = true;
              actionMsg = "START";
              detailMsg = `Zona d'isteresi. Ricarica continuata al minimo: ${config.minChargeCurrent}A.`;
            } else {
              targetCurrent = 0;
              isCharging = false;
              actionMsg = "PAUSE";
              detailMsg = `Zona d'isteresi. Ricarica ferma in attesa di surplus solido.`;
            }
          }
        }

        // Apply hysteresis check (wait limits)
        let finalCurrent = prev.chargerCurrent;
        let finalCharging = prev.chargerCharging;
        let stateChanged = false;

        const forcedOverride = (!isPluggedIn && prev.chargerCharging) || (simChargingMode === "OFF" && prev.chargerCharging); // emergency override

        if (forcedOverride || nextSeconds >= config.hysteresisSeconds || prev.chargerCurrent === 0) {
          if (finalCurrent !== targetCurrent || finalCharging !== isCharging) {
            finalCurrent = targetCurrent;
            finalCharging = isCharging;
            stateChanged = true;
            nextSeconds = 0; // Reset rate timer
          }
        } else {
          // Under rate limit cooldown
          if (finalCurrent !== targetCurrent || finalCharging !== isCharging) {
            // Log that change was blocked by hysteresis cooldown
            if (prev.secondsSinceLastChange % 20 === 0 && !forcedOverride) {
              addLog(
                "Filtro Isteresi",
                `Variazione filtrata dall'anti-rimbalzo temporale (${prev.secondsSinceLastChange}s/${config.hysteresisSeconds}s)`,
                "warning",
                { target: `${targetCurrent}A`, current: `${prev.chargerCurrent}A` }
              );
            }
          }
        }

        // Trigger visual Node-RED signal pulses when state changes or at checkpoints
        if (stateChanged || nextSeconds === 0) {
          setPayloadTriggerState((t) => t + 1);

          // Route the actions according to Routing preference and simulate successes/errors
          const path = simPathPref;
          
          if (path === "API" || path === "PARALLELO") {
            if (apiOnline) {
              addLog(
                "HA API Call",
                `Servizio API chiamato (${isCharging ? "Avvio /" : "Pausa /"} Regolazione @ ${targetCurrent}A)`,
                "api",
                { service: "set_value", current: targetCurrent, target: config.chargerControlEntity }
              );
            } else {
              addLog(
                "HA API Call",
                `ERRORE: Chiamata API fallita per Timeout o Mancata Risposta! (Server HA irraggiungibile)`,
                "warning",
                { target: config.chargerControlEntity }
              );
            }
          }

          if (path === "MQTT" || path === "PARALLELO") {
            if (mqttOnline) {
              addLog(
                "MQTT Pub",
                `Topic MQTT pubblicati: '${config.mqttCurrentSetTopic}' -> ${targetCurrent}A, '${config.mqttPauseSetTopic}' -> ${isCharging ? 0 : 1}`,
                "mqtt",
                { broker: `${config.mqttBrokerHost}:${config.mqttBrokerPort}`, current: targetCurrent }
              );
            } else {
              addLog(
                "MQTT Pub",
                `ERRORE: Impossibile scrivere sul Broker MQTT! Collegamento Offline.`,
                "warning",
                null
              );
            }
          }

          // Log dual-path redundancy fallback if one fails
          if (path === "PARALLELO") {
            if (!apiOnline && mqttOnline) {
              addLog(
                "Ridondanza Attiva",
                `FALLBACK OK: API fallita, ma la Wallbox riceve i comandi tramite MQTT in sicurezza!`,
                "success",
                "MQTT Backup Succeeded"
              );
            } else if (apiOnline && !mqttOnline) {
              addLog(
                "Ridondanza Attiva",
                `FALLBACK OK: Broker MQTT offline, ma la ricarica è guidata tramite API ufficiale di Home Assistant!`,
                "success",
                "API Route Succeeded"
              );
            } else if (!apiOnline && !mqttOnline) {
              addLog(
                "Anomalia Grave",
                `BLACKOUT TOTALE: Entrambi i canali (API + MQTT) sono falliti. La Wallbox è ingovernabile!`,
                "warning",
                "Dual Path Failure"
              );
            }
          } else if (path === "API" && !apiOnline) {
            addLog(
              "Allarme Monitor",
              `Canale preferenziale API KO e MQTT non abilitato come primario o parallelo. Azione bloccata!`,
              "warning",
              "Enable PARALLELO or MQTT routing"
            );
          } else if (path === "MQTT" && !mqttOnline) {
            addLog(
              "Allarme Monitor",
              `Canale preferenziale MQTT KO e percorso API non abilitato. Azione bloccata!`,
              "warning",
              "Enable PARALLELO or API routing"
            );
          }
        }

        return {
          ...prev,
          solarPower: simInputSolar,
          houseConsumption: simInputHouse,
          chargingMode: simChargingMode,
          pathPreference: simPathPref,
          manualCurrent: simManualCurrent,
          isPluggedIn,
          batteryPercent: finalCharging ? Math.min(100, Math.round(prev.batteryPercent + 0.05)) : prev.batteryPercent,
          chargerLocked: prev.chargerLocked,
          chargerCharging: finalCharging,
          chargerCurrent: finalCurrent,
          rawSurplus: rawSurplus,
          smoothedSurplus: smoothedSurplus,
          lastSurplusSamples: samples,
          secondsSinceLastChange: nextSeconds,
          apiStatus: apiOnline ? "ONLINE" : "OFFLINE",
          mqttStatus: mqttOnline ? "ONLINE" : "OFFLINE"
        };
      });
    }, 2000);

    return () => {
      if (coreTimerRef.current) clearInterval(coreTimerRef.current);
    };
  }, [simInputSolar, simInputHouse, simChargingMode, simPathPref, simManualCurrent, isPluggedIn, apiOnline, mqttOnline, config]);

  // Record History chart step
  useEffect(() => {
    historyTimerRef.current = setInterval(() => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString("it-IT", { hour12: false });
      
      setHistoryChart((prev) => {
        const nextHist = [...prev];
        nextHist.push({
          time: timeStr,
          solar: simInputSolar,
          house: simInputHouse,
          surplus: simInputSolar - simInputHouse,
          smoothed: systemState.smoothedSurplus,
          chargeAmps: systemState.chargerCurrent
        });
        if (nextHist.length > 25) {
          nextHist.shift();
        }
        return nextHist;
      });
    }, 4500);

    return () => {
      if (historyTimerRef.current) clearInterval(historyTimerRef.current);
    };
  }, [simInputSolar, simInputHouse, systemState.smoothedSurplus, systemState.chargerCurrent]);

  // Handle single commands like Lock Toggle
  const toggleLockState = () => {
    const nextLocked = !systemState.chargerLocked;
    
    setSystemState((prev) => ({
      ...prev,
      chargerLocked: nextLocked
    }));

    addLog("Blocco Wallbox", `Richiesto cambio stato blocco -> ${nextLocked ? "BLINDATO" : "SBLOCCATO"}`, "info");

    if (simPathPref === "API" || simPathPref === "PARALLELO") {
      if (apiOnline) {
        addLog("HA API Call", `Invocato servizio lock.${nextLocked ? "lock" : "unlock"} su entità: ${config.lockEntity}`, "api");
      } else {
        addLog("HA API Call", `Richiesta blocco FALLITA su HA API per timeout di rete.`, "warning");
      }
    }

    if (simPathPref === "MQTT" || simPathPref === "PARALLELO") {
      if (mqttOnline) {
        addLog("MQTT Pub", `Topic lock inviato: '${config.mqttLockSetTopic}' -> ${nextLocked ? "1" : "0"}`, "mqtt");
      } else {
        addLog("MQTT Pub", `Richiesta blocco FALLITA: Broker MQTT Offline.`, "warning");
      }
    }
  };

  // Immediate Force Action Stop/Start
  const handleForceCharging = (start: boolean) => {
    setSystemState((prev) => {
      const nextCurrent = start ? config.minChargeCurrent : 0;
      addLog("Forzatura Manuale", `Pulsante d'azione rapido premuto: ${start ? "AVVIA CARICA" : "ARRESTA CARICA"}`, "info");

      if (simPathPref === "API" || simPathPref === "PARALLELO") {
        if (apiOnline) {
          addLog("HA API Call", `Avvio rapido inviato a ${config.pauseEntity}. Valore: ${start ? "ON" : "OFF"}`, "api");
        }
      }

      if (simPathPref === "MQTT" || simPathPref === "PARALLELO") {
        if (mqttOnline) {
          addLog("MQTT Pub", `Avvio rapido scritto su ${config.mqttPauseSetTopic}. Valore: ${start ? "0" : "1"}`, "mqtt");
        }
      }

      return {
        ...prev,
        chargerCharging: start,
        chargerCurrent: nextCurrent,
        secondsSinceLastChange: 0 // Reset rate limit to protect steps
      };
    });
  };

  // Node-RED JSON Export String
  const nodeRedJsonString = generateNodeRedJson(config, simPathPref);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(nodeRedJsonString);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Send message to Gemini Assistant on server
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatLoading) return;

    const userMsg = chatInput.trim();
    setChatMessages((prev) => [...prev, { sender: "user", text: userMsg }]);
    setChatInput("");
    setChatLoading(true);

    try {
      // Map frontend chat history to match the expectation on server
      const historyPayload = chatMessages.slice(1).map((m) => ({
        role: m.sender === "user" ? "user" : "model",
        parts: [{ text: m.text }],
      }));

      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          history: historyPayload,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setChatMessages((prev) => [...prev, { sender: "ai", text: data.text }]);
      } else {
        setChatMessages((prev) => [
          ...prev,
          { sender: "ai", text: `Errore: ${data.error || "Impossibile ottenere una risposta."}` },
        ]);
      }
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { sender: "ai", text: "Errore di connessione con il server Gemini. Controlla che le API funzionino." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // List of visual nodes to map on Node-RED Canvas
  const redNodes: RedNode[] = [
    {
      id: "node_solar_sensor",
      label: "Solar Production Sensor",
      type: "sensor",
      x: 30,
      y: 60,
      description: `Ascolta lo stato di '${config.solarPowerEntity}' su HA`,
      lastPayload: `${simInputSolar} W`
    },
    {
      id: "node_house_sensor",
      label: "House Load Sensor",
      type: "sensor",
      x: 30,
      y: 150,
      description: `Ascolta lo stato di '${config.houseConsumptionEntity}' su HA`,
      lastPayload: `${simInputHouse} W`
    },
    {
      id: "node_calc_reduction",
      label: "Calc & Smooth Surplus",
      type: "function",
      x: 280,
      y: 100,
      description: `Sottrae carico a produzione solare. Finestra media mobile: ${config.sampleWindow} impulsi`,
      lastPayload: `${systemState.smoothedSurplus} W (Smooth)`
    },
    {
      id: "node_decide_current",
      label: "ECO / Manual Dispatcher",
      type: "function",
      x: 530,
      y: 100,
      description: `Valuta modalità: ${simChargingMode}. Applica soglie min/max (${config.minChargeCurrent}A - ${config.maxChargeCurrent}A)`,
      lastPayload: `${systemState.chargerCharging ? "START" : "PAUSE"} - ${systemState.chargerCurrent}A`
    },
    {
      id: "node_hysteresis_check",
      label: "Hysteresis Window",
      type: "delay",
      x: 530,
      y: 200,
      description: `Previene modifiche costanti. Interval rate limit: ${config.hysteresisSeconds}s`,
      lastPayload: `${systemState.secondsSinceLastChange}s trascurati`
    },
    {
      id: "node_routing_switch",
      label: "Routing: Dual-Path Switch",
      type: "switch",
      x: 770,
      y: 200,
      description: `Smista i comandi: Preferenza impostata su '${simPathPref}'`,
      lastPayload: simPathPref
    },
    {
      id: "node_ha_api_adapter",
      label: "HA API Adapter",
      type: "function",
      x: 990,
      y: 120,
      description: `Converte comandi in payload di chiamata per '${config.chargerControlEntity}'`,
      lastPayload: `{ value: ${systemState.chargerCurrent} }`
    },
    {
      id: "node_mqtt_adapter",
      label: "MQTT Adapter",
      type: "function",
      x: 990,
      y: 280,
      description: `Converte comandi in argomenti MQTT per '${config.mqttCurrentSetTopic}'`,
      lastPayload: `topic / payload (${systemState.chargerCurrent}A)`
    },
    {
      id: "node_ha_call_service_current",
      label: "HA service: number.set_value",
      type: "api-call",
      x: 1210,
      y: 120,
      description: `Esegue la chiamata REST/WS verso le API di Home Assistant`,
      lastPayload: apiOnline ? "OK - ONLINE" : "FAIL - DISCONNECTED",
      hasError: !apiOnline
    },
    {
      id: "node_mqtt_out_current",
      label: "MQTT Pub: set_current",
      type: "mqtt-out",
      x: 1210,
      y: 280,
      description: `Invia il payload binario sul broker Mosquitto locale`,
      lastPayload: mqttOnline ? "OK - ONLINE" : "FAIL - DISCONNECTED",
      hasError: !mqttOnline
    }
  ];

  const redEdges: RedEdge[] = [
    { id: "e1", from: "node_solar_sensor", to: "node_calc_reduction" },
    { id: "e2", from: "node_house_sensor", to: "node_calc_reduction" },
    { id: "e3", from: "node_calc_reduction", to: "node_decide_current" },
    { id: "e4", from: "node_decide_current", to: "node_hysteresis_check" },
    { id: "e5", from: "node_hysteresis_check", to: "node_routing_switch" },
    { id: "e6", from: "node_routing_switch", to: "node_ha_api_adapter" },
    { id: "e7", from: "node_routing_switch", to: "node_mqtt_adapter" },
    { id: "e8", from: "node_ha_api_adapter", to: "node_ha_call_service_current" },
    { id: "e9", from: "node_mqtt_adapter", to: "node_mqtt_out_current" }
  ];

  // Helper code lookup for inspector
  const getNodeCode = (id: string): string => {
    switch (id) {
      case "node_calc_reduction":
        return `// Estrazione e calcolo surplus
let solar = msg.topic === "${config.solarPowerEntity}" ? msg.payload : context.get("sol") || 0;
let house = msg.topic === "${config.houseConsumptionEntity}" ? msg.payload : context.get("con") || 0;
context.set("sol", solar);
context.set("con", house);

let surplus = solar - house;
let array = context.get("media") || [];
array.push(surplus);
if(array.length > ${config.sampleWindow}) array.shift();
context.set("media", array);

msg.payload = array.reduce((a,b)=>a+b,0) / array.length;
return msg;`;
      case "node_decide_current":
        return `//ECO vs Manual Dispatcher
let mode = flow.get("mode") || "ECO";
if(mode === "MANUALE") {
  msg.action = "START";
  msg.ampere = flow.get("manual_current") || 10;
  return msg;
}
let surplus = msg.payload;
if (surplus >= ${config.startThresholdWatts}) {
  msg.ampere = Math.floor(surplus / ${config.singlePhaseVoltage});
  msg.action = "START";
} else {
  msg.ampere = 0;
  msg.action = "PAUSE";
}
return msg;`;
      case "node_hysteresis_check":
        return `// Controllo dell'isteresi temporale
let last = flow.get("last_change") || 0;
let now = Date.now();
if (now - last < ${config.hysteresisSeconds} * 1000) {
  if (msg.ampere !== flow.get("active_amp")) {
    return null; // Frena modifiche repentine!
  }
}
flow.set("last_change", now);
flow.set("active_amp", msg.ampere);
return msg;`;
      case "node_routing_switch":
        return `// Doppia Ridondanza Routing
let pref = "${simPathPref}"; // API, MQTT o PARALLELO
let out1 = (pref==="API" || pref==="PARALLELO") ? msg : null;
let out2 = (pref==="MQTT" || pref==="PARALLELO") ? msg : null;
return [out1, out2];`;
      default:
        return `// Nodo nativo Node-RED. Esecuzione standard.\nmsg.payload = msg.payload;\nreturn msg;`;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-200 selection:bg-sky-500 selection:text-slate-950">
      
      {/* HEADER BAR */}
      <header className="border-b border-slate-800 bg-slate-900/50 px-6 py-4 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-sky-500 rounded flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(14,165,233,0.4)]">
              <Cpu className="w-5.5 h-5.5 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="rounded bg-sky-500/10 border border-sky-500/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-sky-400 uppercase">HAOS + Node-RED</span>
                <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-emerald-400 uppercase">Redundant Core</span>
              </div>
              <h1 className="text-xl font-extrabold tracking-tight text-white uppercase mt-0.5">
                PULSAR MAX <span className="text-sky-400 font-light">COMMAND CENTER</span>
              </h1>
            </div>
          </div>

          {/* TABS SELECTOR */}
          <nav className="flex flex-wrap gap-2">
            {[
              { id: "dashboard", label: "Dashboard", icon: Sliders },
              { id: "node-red", label: "Schema Node-RED", icon: Cpu },
              { id: "setup", label: "Punti di Setup", icon: Settings },
              { id: "json", label: "Esporta JSON", icon: Copy },
              { id: "guide", label: "Guida e Test", icon: BookOpen },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`tab-btn-${tab.id}`}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold uppercase tracking-wider border rounded-lg transition-all duration-200 ${
                    active
                      ? "bg-sky-500/10 border-sky-500/40 text-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.15)]"
                      : "bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700 hover:text-white"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* SYSTEM METRICS BAR */}
      <div className="border-b border-slate-800 bg-slate-950 px-6 py-2.5 text-xs text-slate-400">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between items-center gap-4">
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></div>
              <span>Solar Input: <strong className="text-slate-100 font-mono">{simInputSolar} W</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></div>
              <span>Carico Casa: <strong className="text-slate-100 font-mono">{simInputHouse} W</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${simInputSolar - simInputHouse >= 0 ? "bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"}`}></div>
              <span>Surplus Istantaneo: <strong className="text-slate-100 font-mono">{simInputSolar - simInputHouse} W</strong></span>
            </div>
            <div className="hidden md:flex items-center gap-2 border-l border-slate-800 pl-4">
              <span className="text-slate-500 text-[10px] uppercase font-bold tracking-tight">Media Mobile ({config.sampleWindow}pt):</span>
              <span className="font-semibold font-mono text-sky-400">{systemState.smoothedSurplus} W</span>
            </div>
            <div className="hidden lg:flex items-center gap-2 border-l border-slate-800 pl-4">
              <span className="text-slate-500 text-[10px] uppercase font-bold tracking-tight">Isteresi Cooldown:</span>
              <span className="font-mono text-amber-400">{systemState.secondsSinceLastChange}s / {config.hysteresisSeconds}s</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 bg-slate-900 rounded-full border border-slate-800">
              <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold">Redundancy:</span>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">DUAL-PATH ACTIVE</span>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">

        {/* ========================================================
            TAB 1: INTERACTIVE HA & WALLBOX SIMULATOR DASHBOARD
            ======================================================== */}
        {activeTab === "dashboard" && (
          <div className="space-y-8">
            
            {/* ROW 1: SIMULATOR CONTROL & INPUTS (Left) + REALTIME WALLBOX STATUS (Right) */}
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
              
              {/* Inputs & Sim Settings (Col 1 to 5) */}
              <div className="space-y-6 lg:col-span-5">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-5 shadow-lg">
                  <div className="mb-2 flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <Sliders className="h-5 w-5 text-sky-400 shadow-[0_0_8px_rgba(14,165,233,0.3)]" />
                      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Generatori e Carichi Impianto</h2>
                    </div>
                    <span className="rounded bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-450 text-sky-400 uppercase font-mono">Input Vars</span>
                  </div>

                  {/* Solar simulation range */}
                  <div className="space-y-5">
                    <div>
                      <div className="mb-2 flex justify-between text-xs font-medium">
                        <span className="flex items-center gap-1.5 text-slate-300 font-semibold uppercase tracking-wider text-[11px]">
                          <CloudSun className="h-4 w-4 text-amber-500" />
                          Generazione Solare (W)
                        </span>
                        <span className="font-mono font-bold text-amber-500 text-sm">{simInputSolar} W</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="8000"
                        step="100"
                        value={simInputSolar}
                        draggable="false"
                        onChange={(e) => setSimInputSolar(Number(e.target.value))}
                        disabled={oscillateWeather}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded bg-slate-950 accent-amber-500 disabled:opacity-50"
                      />
                      <div className="mt-1.5 flex justify-between text-[10px] text-slate-500 font-mono">
                        <span>BUIO (0W)</span>
                        <span>MEDIO (3kW)</span>
                        <span>PICCO (8kW)</span>
                      </div>
                    </div>

                    {/* House load simulation range */}
                    <div>
                      <div className="mb-2 flex justify-between text-xs font-medium">
                        <span className="flex items-center gap-1.5 text-slate-300 font-semibold uppercase tracking-wider text-[11px]">
                          <Zap className="h-4 w-4 text-indigo-400" />
                          Consumo Domestico (W)
                        </span>
                        <span className="font-mono font-bold text-indigo-400 text-sm">{simInputHouse} W</span>
                      </div>
                      <input
                        type="range"
                        min="200"
                        max="6000"
                        step="50"
                        value={simInputHouse}
                        draggable="false"
                        onChange={(e) => setSimInputHouse(Number(e.target.value))}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded bg-slate-950 accent-indigo-505 accent-indigo-500"
                      />
                      <div className="mt-1.5 flex justify-between text-[10px] text-slate-500 font-mono font-medium">
                        <span>MIN (200W)</span>
                        <span>STANDARD (1.5kW)</span>
                        <span>CARICHI PESANTI (6kW)</span>
                      </div>
                    </div>

                    {/* Manual Charge Limit Slide (Ampere) */}
                    <div className="border-t border-slate-800 pt-4">
                      <div className="mb-2 flex justify-between text-xs font-medium">
                        <span className="flex items-center gap-1.5 text-slate-300 font-semibold uppercase tracking-wider text-[11px]">
                          <Sliders className="h-4 w-4 text-sky-400" />
                          Corrente Manuale (A)
                        </span>
                        <span className="font-mono font-bold text-sky-400 text-sm">{simManualCurrent} A</span>
                      </div>
                      <input
                        type="range"
                        min={config.minChargeCurrent}
                        max={config.maxChargeCurrent}
                        step="1"
                        value={simManualCurrent}
                        draggable="false"
                        onChange={(e) => setSimManualCurrent(Number(e.target.value))}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded bg-slate-950 accent-sky-500"
                      />
                      <div className="mt-1.5 flex justify-between text-[10px] text-slate-500 font-mono">
                        <span>MIN ({config.minChargeCurrent}A - 1.4kW)</span>
                        <span>DEFAULT (10A - 2.3kW)</span>
                        <span>MAX ({config.maxChargeCurrent}A - {Math.round(config.maxChargeCurrent * config.singlePhaseVoltage / 100) / 10}kW)</span>
                      </div>
                    </div>

                    {/* Simulation Triggers & Injectors */}
                    <div className="border-t border-slate-800 pt-4 space-y-3">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Simula Anomalie & Meteo</h3>
                      
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        {/* Weather Oscillation */}
                        <button
                          onClick={() => setOscillateWeather(!oscillateWeather)}
                          className={`flex items-center justify-between p-2.5 rounded-lg border text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${
                            oscillateWeather
                              ? "bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.15)]"
                              : "bg-slate-850 border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-slate-300"
                          }`}
                        >
                          <span>Meteo Clima</span>
                          <div className={`w-2 h-2 rounded-full ${oscillateWeather ? "bg-amber-400 animate-ping" : "bg-slate-600"}`}></div>
                        </button>

                        {/* API Down Toggle */}
                        <button
                          onClick={() => {
                            setApiOnline(!apiOnline);
                            addLog("Network Monitor", `Integrazione API Home Assistant forzata -> ${!apiOnline ? 'ONLINE' : 'OFFLINE'}`, "warning");
                          }}
                          className={`flex items-center justify-between p-2.5 rounded-lg border text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${
                            !apiOnline
                              ? "bg-red-500/10 border-red-500/50 text-red-400"
                              : "bg-slate-850 border-slate-700 text-slate-400 hover:bg-slate-850 hover:text-red-450 hover:text-red-400 hover:border-red-500/30"
                          }`}
                        >
                          <span>Guasto API</span>
                          <div className={`w-2 h-2 rounded-full ${!apiOnline ? "bg-red-500 shadow-[0_0_6px_#ef4444]" : "bg-emerald-500"}`}></div>
                        </button>

                        {/* MQTT Down Toggle */}
                        <button
                          onClick={() => {
                            setMqttOnline(!mqttOnline);
                            addLog("MQTT Monitor", `Connessione broker MQTT forzata -> ${!mqttOnline ? 'ONLINE' : 'OFFLINE'}`, "warning");
                          }}
                          className={`flex items-center justify-between p-2.5 rounded-lg border text-[11px] font-bold uppercase tracking-wider transition-all duration-200 ${
                            !mqttOnline
                              ? "bg-red-500/10 border-red-500/50 text-red-400"
                              : "bg-slate-850 border-slate-700 text-slate-400 hover:bg-slate-850 hover:text-red-450 hover:text-red-400 hover:border-red-500/30"
                          }`}
                        >
                          <span>Guasto MQTT</span>
                          <div className={`w-2 h-2 rounded-full ${!mqttOnline ? "bg-red-500 shadow-[0_0_6px_#ef4444]" : "bg-emerald-500"}`}></div>
                        </button>
                      </div>

                      {/* Cable Plugging Simulation */}
                      <div className="flex items-center justify-between bg-slate-950 border border-slate-800 p-4 rounded-lg text-xs mt-2">
                        <span className="text-slate-400 uppercase tracking-wider font-semibold text-[10px]">Cavo di Ricarica EV:</span>
                        <button
                          onClick={() => {
                            setIsPluggedIn(!isPluggedIn);
                            addLog("Wallbox Sensor", `Simulatore cavo di ricarica: ${!isPluggedIn ? "CONNESSO" : "SCOLLEGATO"}`, "info");
                          }}
                          className={`rounded px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all border ${
                            isPluggedIn
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.1)]"
                              : "bg-red-500/10 text-red-400 border-red-500/30"
                          }`}
                        >
                          {isPluggedIn ? "Inserito" : "Staccato"}
                        </button>
                      </div>

                    </div>
                  </div>
                </div>
              </div>

              {/* Physical/Operational Wallbox Status (Col 6 to 12) */}
              <div className="space-y-6 lg:col-span-7">
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                  
                  {/* Status header */}
                  <div className="mb-6 flex flex-col justify-between gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center">
                    <div>
                      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Stato Operativo Wallbox</h2>
                      <p className="text-xs text-slate-500 font-medium">Letture simulatore del dispositivo hardware sul campo</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Redundancy status:</span>
                      <div className="flex gap-1.5">
                        <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-[9px] font-bold font-mono tracking-wider transition-all duration-200 ${systemState.apiStatus === "ONLINE" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400 animate-pulse"}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${systemState.apiStatus === "ONLINE" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500 animate-ping"}`}></div>
                          API
                        </div>
                        <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full border text-[9px] font-bold font-mono tracking-wider transition-all duration-200 ${systemState.mqttStatus === "ONLINE" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border-red-500/30 text-red-400 animate-pulse"}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${systemState.mqttStatus === "ONLINE" ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500 animate-ping"}`}></div>
                          MQTT
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Main Indicators Panel */}
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    
                    {/* State charge */}
                    <div className="border border-slate-800 bg-slate-950 p-4 rounded-xl text-center flex flex-col justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Stato Ricarica</span>
                      <div className="mt-2.5 flex items-center justify-center gap-2">
                        {systemState.chargerCharging ? (
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse"></div>
                        ) : (
                          <div className="w-2.5 h-2.5 rounded-full bg-slate-600"></div>
                        )}
                        <span className={`text-xs font-extrabold uppercase tracking-wider ${systemState.chargerCharging ? "text-emerald-450 text-emerald-400" : "text-slate-400"}`}>
                          {systemState.chargerCharging ? "ATTIVO" : "IN PAUSA"}
                        </span>
                      </div>
                      <p className="mt-2 text-[10px] font-mono text-slate-505 text-slate-500">{isPluggedIn ? "Cavo Connesso" : "Cavo Scollegato"}</p>
                    </div>

                    {/* Limit Amperage */}
                    <div className="border border-slate-800 bg-slate-950 p-4 rounded-xl text-center flex flex-col justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-sans">Limite Potenza</span>
                      <div className="mt-1.5 text-3xl font-light text-white font-mono">
                        {systemState.chargerCurrent}<span className="text-sm font-semibold uppercase text-slate-500 ml-1">A</span>
                      </div>
                      <p className="mt-2 text-[10px] font-mono text-sky-400 font-semibold">
                        ~{Math.round((systemState.chargerCurrent * config.singlePhaseVoltage) / 10) / 100} kW
                      </p>
                    </div>

                    {/* Charger safety lock */}
                    <div className="border border-slate-800 bg-slate-950 p-4 rounded-xl text-center flex flex-col justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-sans">Blocco Sicurezza</span>
                      <div className="mt-2.5 flex items-center justify-center gap-2">
                        {systemState.chargerLocked ? (
                          <Lock className="h-4 w-4 text-red-500" />
                        ) : (
                          <Unlock className="h-4 w-4 text-emerald-400" />
                        )}
                        <span className={`text-xs font-bold uppercase tracking-wider ${systemState.chargerLocked ? "text-red-400" : "text-emerald-400"}`}>
                          {systemState.chargerLocked ? "BLINDATO" : "SBLOCCATO"}
                        </span>
                      </div>
                      <p className="mt-2 text-[10px] text-slate-500 font-mono">Richiede Pin / App</p>
                    </div>

                    {/* Battery simulation */}
                    <div className="border border-slate-800 bg-slate-950 p-4 rounded-xl text-center flex flex-col justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 font-sans">Batteria Auto</span>
                      <div className="mt-1.5 text-3xl font-light text-white font-mono">
                        {systemState.batteryPercent}<span className="text-sm font-semibold text-slate-500 ml-0.5">%</span>
                      </div>
                      <p className="mt-2 text-[10px] font-mono text-slate-500">
                        {systemState.chargerCharging ? "In Ricarica" : "Dispositivo Fermo"}
                      </p>
                    </div>

                  </div>

                  {/* Operational Settings Switches */}
                  <div className="mt-6 grid grid-cols-1 gap-5 rounded-xl border border-slate-800 bg-slate-900/40 p-5 sm:grid-cols-3">
                    
                    {/* Operational MODES */}
                    <div className="space-y-2.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block font-sans">Selettore Modalità</span>
                      <div className="flex p-1 bg-slate-950 rounded-lg border border-slate-800 text-xs">
                        {["ECO", "MANUALE", "OFF"].map((mode) => (
                          <button
                            key={mode}
                            id={`mode-btn-${mode}`}
                            onClick={() => {
                              setSimChargingMode(mode as any);
                              addLog("Dashboard", `Selezionata modalità operativa: ${mode}`, "info");
                            }}
                            className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded tracking-wider transition-all duration-200 ${
                              simChargingMode === mode
                                ? "bg-sky-500 text-white shadow-[0_0_8px_rgba(14,165,233,0.3)]"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-500 leading-normal italic">
                        {simChargingMode === "ECO" && "*ECO Solar: Modula in base al surplus FV dinamico filtrato."}
                        {simChargingMode === "MANUALE" && "*Override manuale: Amperaggio fisso e costante."}
                        {simChargingMode === "OFF" && "*OFF: Disattiva la Wallbox interrompendo i circuiti."}
                      </p>
                    </div>

                    {/* Routing Preference Switch */}
                    <div className="space-y-2.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block font-sans">Routing Switch</span>
                      <div className="flex p-1 bg-slate-950 rounded-lg border border-slate-800 text-xs">
                        {["API", "MQTT", "PARALLELO"].map((pref) => (
                          <button
                            key={pref}
                            id={`routing-btn-${pref}`}
                            onClick={() => {
                              setSimPathPref(pref as any);
                              addLog("Dashboard", `Smistamento flusso configurato su: ${pref}`, "success");
                            }}
                            className={`flex-1 py-1.5 text-[9px] font-bold uppercase rounded tracking-wider transition-all duration-200 ${
                              simPathPref === pref
                                ? "bg-sky-500 text-white shadow-[0_0_8px_rgba(14,165,233,0.3)]"
                                : "text-slate-400 hover:text-slate-200"
                            }`}
                          >
                            {pref}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-500 leading-normal italic">
                        {simPathPref === "API" && "*HA Integration: Canale primario cloud/locale JSON-RPC."}
                        {simPathPref === "MQTT" && "*Direct MQTT path: Topic raw rapidissimi e asincroni."}
                        {simPathPref === "PARALLELO" && "*Doppia Ridondanza: Invio simmetrico a rotazione continua."}
                      </p>
                    </div>

                    {/* Action buttons (avvio/stop, sblocco) */}
                    <div className="space-y-2.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 block font-sans">Azioni Sollecitate</span>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {/* Start/Stop Charge */}
                        <button
                          onClick={() => handleForceCharging(!systemState.chargerCharging)}
                          className={`py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all duration-200 ${
                            systemState.chargerCharging
                              ? "bg-red-500/20 border border-red-500/40 text-red-00 text-red-400 hover:bg-red-500/30"
                              : "bg-emerald-500/20 border border-emerald-500/40 text-emerald-450 text-emerald-400 hover:bg-emerald-500/30"
                          }`}
                        >
                          {systemState.chargerCharging ? "Pausa EV" : "Avvia EV"}
                        </button>

                        {/* Lock/Unlock Switch */}
                        <button
                          onClick={toggleLockState}
                          className={`py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all duration-200 ${
                            systemState.chargerLocked
                              ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-450 text-emerald-400 hover:bg-emerald-500/30"
                              : "bg-red-500/20 border border-red-500/40 text-red-400 hover:bg-red-500/30"
                          }`}
                        >
                          {systemState.chargerLocked ? "Sblocca" : "Blocca"}
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-normal italic">
                        *Override rapidi istantanei per bypassare l'isteresi solare dei 5 minuti.
                      </p>
                    </div>

                  </div>

                </div>
              </div>

            </div>

            {/* ROW 2: GRAPHICAL CHRONOPLOT ON STATE VARIATIONS (SVG rendering of timeline data) */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <div className="mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-slate-300">
                    <TrendingUp className="h-5 w-5 text-sky-400 shadow-[0_0_8px_rgba(14,165,233,0.3)]" />
                    Analisi Grafica Storica Realtime (Surplus vs Corrente)
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">Visore dell'effetto dello smoothing a media mobile e del filtro anti-rimbalzo</p>
                </div>
                <div className="flex flex-wrap gap-4 text-[10px] font-mono">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]"></span> FV (W)</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_6px_rgba(99,102,241,0.5)]"></span> Casa (W)</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-400"></span> Surplus Ist.</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-450 bg-sky-400 shadow-[0_0_6px_rgba(14,165,233,0.5)]"></span> Media Mobile</span>
                  <span className="flex items-center gap-1.5"><span className="rounded bg-sky-500/10 px-1.5 py-0.5 border border-sky-500/25 text-sky-305 text-sky-300">Carica (Amps)</span></span>
                </div>
              </div>

              {/* Render scrolling visual representation of metrics */}
              <div className="relative h-64 w-full rounded-xl bg-slate-950 p-4 border border-slate-800 font-mono text-xs">
                
                {/* SVG Visual plot */}
                <div className="absolute inset-0 p-8 flex items-end">
                  <svg className="h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                    
                    {/* Grid lines */}
                    <line x1="0" y1="0" x2="100" y2="0" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2" />
                    <line x1="0" y1="25" x2="100" y2="25" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2" />
                    <line x1="0" y1="50" x2="100" y2="50" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2" />
                    <line x1="0" y1="75" x2="100" y2="75" stroke="#1e293b" strokeWidth="0.5" strokeDasharray="2" />
                    <line x1="0" y1="100" x2="100" y2="100" stroke="#1e293b" strokeWidth="0.5" />

                    {/* Coordinates conversion logic */}
                    {historyChart.length > 1 && (() => {
                      const maxPower = 8500;
                      const convertX = (index: number) => (index / (historyChart.length - 1)) * 100;
                      const convertY = (val: number) => 100 - (val / maxPower) * 100;

                      // Create paths
                      const solarPoints = historyChart.map((d, i) => `${convertX(i)},${convertY(d.solar)}`).join(" ");
                      const housePoints = historyChart.map((d, i) => `${convertX(i)},${convertY(d.house)}`).join(" ");
                      const originalPoints = historyChart.map((d, i) => `${convertX(i)},${convertY(d.surplus)}`).join(" ");
                      const smoothedPoints = historyChart.map((d, i) => `${convertX(i)},${convertY(d.smoothed)}`).join(" ");

                      // Charge Amp bar points (we plot them relative, 16Amps behaves like 4kW equivalent)
                      const chargePoints = historyChart.map((d, i) => {
                        const equivWatt = d.chargeAmps * 230;
                        return `${convertX(i)},${convertY(equivWatt)}`;
                      }).join(" ");

                      return (
                        <>
                          {/* Solar Curve */}
                          <polyline fill="none" stroke="#f59e0b" strokeWidth="1.5" points={solarPoints} />
                          {/* House load Curve */}
                          <polyline fill="none" stroke="#6366f1" strokeWidth="1.2" points={housePoints} />
                          {/* Raw Surplus curve */}
                          <polyline fill="none" stroke="#f87171" strokeWidth="1" strokeDasharray="1" points={originalPoints} />
                          {/* Smoothed Surplus curve */}
                          <polyline fill="none" stroke="#0ea5e9" strokeWidth="2.5" points={smoothedPoints} />
                          
                          {/* Charge Area block */}
                          <path
                            fill="rgba(14, 165, 233, 0.08)"
                            stroke="#38bdf8"
                            strokeWidth="1.5"
                            strokeDasharray="3,1"
                            d={`M 0,100 ${historyChart.map((d, i) => {
                              const equivWatt = d.chargeAmps * 230;
                              return `L ${convertX(i)},${convertY(equivWatt)}`;
                            }).join(" ")} L 100,100 Z`}
                          />
                        </>
                      );
                    })()}
                  </svg>
                </div>

                {/* Left Y-axis ticks */}
                <div className="absolute left-2.5 top-2 divide-y divide-transparent h-[85%] flex flex-col justify-between text-[10px] text-slate-500 select-none">
                  <span>8.5 kW</span>
                  <span>5.0 kW</span>
                  <span>2.5 kW</span>
                  <span>0W (Zero)</span>
                </div>

                {/* Timeline status label */}
                <div className="absolute bottom-2 right-4 text-[10px] text-slate-500">
                  Campionamento attivo in tempo reale • Aggiornato ogni 4.5s
                </div>
              </div>
            </div>

            {/* ROW 3: LOG CONSOLE INTERACTION */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-sky-400 shadow-[0_0_8px_rgba(14,165,233,0.3)]" />
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Console Eventi Flusso & Logger Doppia Ridondanza</h2>
                </div>
                <button
                  onClick={() => {
                    setLogs([]);
                    addLog("Logger", "Console pulita manualmente.", "info");
                  }}
                  className="rounded-lg border border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-200 bg-slate-850"
                >
                  Pulisci Log
                </button>
              </div>

              {/* Log stream window */}
              <div className="h-60 overflow-y-auto rounded-xl bg-slate-950 p-4 font-mono text-[11px] border border-slate-800 space-y-2">
                {logs.length === 0 ? (
                  <p className="text-slate-600 text-center py-16">In attesa di eventi... Sposta i cursori o simula cadute di rete per visualizzare gli eventi.</p>
                ) : (
                  logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-start gap-4 border-b border-slate-900/40 pb-2 leading-relaxed"
                    >
                      <span className="text-slate-500 shrink-0 select-none font-mono">{log.timestamp}</span>
                      
                      {/* Badge class */}
                      <span className={`px-1.5 py-0.5 rounded font-bold uppercase text-[9px] shrink-0 select-none tracking-wider ${
                        log.type === "success" && "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      } ${
                        log.type === "api" && "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                      } ${
                        log.type === "mqtt" && "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
                      } ${
                        log.type === "warning" && "bg-red-500/10 text-red-400 border border-red-500/25 animate-pulse"
                      } ${
                        log.type === "info" && "bg-slate-800 text-slate-300 border border-slate-700"
                      }`}>
                        {log.nodeLabel}
                      </span>

                      <div className="flex-1">
                        <p className="text-slate-300 font-sans font-medium">{log.message}</p>
                        {log.payload && (
                          <pre className="mt-1.5 max-w-full overflow-x-auto rounded bg-slate-900/60 p-2 text-[10px] text-slate-400 border border-slate-800">
                            {JSON.stringify(log.payload)}
                          </pre>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}

        {/* ========================================================
            TAB 2: VISUAL SCHEMA NODE-RED (INTERACTIVE CANVAS)
            ======================================================== */}
        {activeTab === "node-red" && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            
            {/* Visual Canvas (Col 1 to 8) */}
            <div className="space-y-4 lg:col-span-8">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
                <div className="mb-4">
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Visualizzazione Canvas Node-RED (Dual-Path)</h2>
                  <p className="text-xs text-slate-500 font-medium">Schema circuitale del flusso in tempo reale. Clicca su un nodo per analizzarlo.</p>
                </div>

                {/* Node-RED Workspace Canvas Container */}
                <div className="relative h-[480px] w-full overflow-hidden rounded-xl bg-[radial-gradient(#1e293b_1px,transparent_1px)] bg-slate-950 p-4 border border-slate-800 [background-size:20px_20px]">
                  
                  {/* Visual Node Links/Edges */}
                  <svg className="absolute inset-0 h-full w-full pointer-events-none overflow-visible">
                    {/* Connections mapping */}
                    {redEdges.map((edge) => {
                      const fromNode = redNodes.find((n) => n.id === edge.from);
                      const toNode = redNodes.find((n) => n.id === edge.to);
                      if (!fromNode || !toNode) return null;

                      // Coordinates (Center offset approximation)
                      const x1 = fromNode.x + 195;
                      const y1 = fromNode.y + 24;
                      const x2 = toNode.x;
                      const y2 = toNode.y + 24;

                      // Curvature Control
                      const dx = Math.abs(x2 - x1) * 0.4;
                      const pathD = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

                      return (
                        <g key={edge.id}>
                          {/* Shadow wire */}
                          <path
                            d={pathD}
                            fill="none"
                            stroke="#0f172a"
                            strokeWidth="5"
                          />
                          {/* Solid wire */}
                          <path
                            d={pathD}
                            fill="none"
                            stroke="#475569"
                            strokeWidth="2.5"
                          />
                          {/* Active flowing message pulses when simulation runs */}
                          <path
                            d={pathD}
                            fill="none"
                            stroke="#06b6d4"
                            strokeWidth="2.5"
                            className="animate-pulse-connection"
                            style={{
                              opacity: systemState.chargerCharging ? 0.9 : 0.25,
                              stroke: edge.to.includes("ha_call") && !apiOnline ? "#ef4444" : edge.to.includes("mqtt_out") && !mqttOnline ? "#ef4444" : "#22d3ee"
                            }}
                          />
                        </g>
                      );
                    })}
                  </svg>

                  {/* Render Node-RED Node elements */}
                  {redNodes.map((node) => {
                    const active = selectedNode === node.id;
                    return (
                      <div
                        key={node.id}
                        onClick={() => setSelectedNode(node.id)}
                        id={`node-${node.id}`}
                        style={{
                          left: `${node.x}px`,
                          top: `${node.y}px`
                        }}
                        className={`absolute w-[195px] cursor-pointer rounded-lg border p-2.5 transition-all duration-200 select-none shadow-md ${
                          active
                            ? "border-cyan-400 bg-slate-900 ring-2 ring-cyan-400/20 z-20"
                            : "border-slate-800 bg-slate-900/90 hover:border-slate-700 hover:bg-slate-900 z-10"
                        } ${node.hasError ? "border-red-500 bg-red-950/20" : ""}`}
                      >
                        {/* Node content structure */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 max-w-[150px]">
                            {/* Colorful badge relative to type */}
                            <span className={`h-2.5 w-2.5 rounded ${
                              node.type === "sensor" ? "bg-amber-500" :
                              node.type === "function" ? "bg-cyan-500" :
                              node.type === "switch" ? "bg-indigo-500" :
                              node.type === "api-call" ? "bg-purple-600" :
                              node.type === "mqtt-out" ? "bg-indigo-400" : "bg-slate-500"
                            }`}></span>
                            <span className="truncate font-display text-2xs font-extrabold tracking-tight text-white">{node.label}</span>
                          </div>
                          
                          {/* Small node status indicator */}
                          <span className="text-[9px] text-slate-500 select-none font-sans lowercase">
                            {node.type}
                          </span>
                        </div>

                        {/* Node status / payload line */}
                        <div className="mt-2 flex items-center justify-between border-t border-slate-800/60 pt-1.5">
                          <span className="truncate font-mono text-[9px] text-slate-400 max-w-[120px]">
                            {node.lastPayload !== undefined ? String(node.lastPayload) : "msg..."}
                          </span>
                          
                          {/* Node specific details */}
                          <div className="relative flex h-2 w-2">
                            {node.hasError ? (
                              <span className="inline-flex rounded-full h-2 w-2 bg-red-400 animate-ping"></span>
                            ) : (
                              <span className={`inline-flex rounded-full h-1.5 w-1.5 ${systemState.chargerCharging ? "bg-cyan-400" : "bg-slate-600"}`}></span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                </div>
              </div>
            </div>

            {/* Inspector side panel (Col 9 to 12) */}
            <div className="space-y-6 lg:col-span-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg h-full flex flex-col justify-between">
                <div>
                  <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <Info className="h-5 w-5 text-sky-400 shadow-[0_0_8px_rgba(14,165,233,0.3)]" />
                      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Ispettore Nodo</h2>
                    </div>
                    <span className="rounded bg-indigo-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-indigo-400 border border-indigo-500/20">Node Properties</span>
                  </div>

                  {selectedNode ? (() => {
                    const node = redNodes.find((n) => n.id === selectedNode);
                    if (!node) return <p className="text-slate-500 text-xs">Seleziona un nodo per visualizzarlo nell'ispettore.</p>;

                    return (
                      <div className="space-y-4 text-xs">
                        <div>
                          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500 select-none">Node ID</label>
                          <div className="font-mono bg-slate-950 px-3 py-2 rounded-lg border border-slate-800 mt-1.5 select-all text-slate-300">
                            {node.id}
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500 font-sans select-none">Etichetta Display</label>
                          <p className="mt-1.5 text-xs font-bold text-slate-200">{node.label}</p>
                        </div>

                        <div>
                          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500 select-none">Destinazione e Descrizione</label>
                          <p className="mt-1.5 text-slate-300 font-sans text-xs select-text leading-relaxed">{node.description}</p>
                        </div>

                        <div>
                          <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500 select-none">Recent Payload (msg.payload)</label>
                          <pre className="mt-1.5 bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[10px] text-sky-400 select-text">
                            {JSON.stringify({
                              topic: node.id,
                              payload: node.type === "sensor" ? (node.id.includes("solar") ? simInputSolar : simInputHouse) : node.lastPayload,
                              timestamp: new Date().toLocaleTimeString("it-IT", { hour12: false })
                            }, null, 2)}
                          </pre>
                        </div>

                        {node.codeSnippet || node.type === "function" ? (
                          <div>
                            <label className="text-[10px] uppercase font-bold tracking-widest text-slate-500 select-none">Codice Javascript Eseguito (JSON.func)</label>
                            <pre className="mt-1.5 max-h-56 overflow-y-auto bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono text-[10px] text-emerald-400 select-text leading-normal whitespace-pre-wrap">
                              {getNodeCode(node.id)}
                            </pre>
                          </div>
                        ) : null}

                      </div>
                    );
                  })() : (
                    <p className="text-slate-500 text-sm py-12 text-center select-none">Clicca su uno qualsiasi dei blocchi Node-RED a sinistra per visualizzare le intestazioni, i codici Javascript e lo stato dei payload in tempo reale.</p>
                  )}
                </div>

                <div className="mt-6 border-t border-slate-800 pt-4 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-505 text-slate-550 text-slate-500 block">Hai bisogno di personalizzare questo codice?</span>
                  <button
                    onClick={() => {
                      setActiveTab("guide");
                      setTimeout(() => {
                        const btn = document.getElementById("tab-btn-guide");
                        if (btn) btn.click();
                      }, 200);
                    }}
                    className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500/10 border border-sky-500/20 py-2 text-xs font-bold uppercase tracking-wider text-sky-400 hover:bg-sky-500/15 hover:border-sky-500/30 transition-all duration-200"
                  >
                    <span>Leggi istruzioni di Test</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ========================================================
            TAB 3: SETUP CONFIGURATOR
            ======================================================== */}
        {activeTab === "setup" && (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
            <div className="mb-6 border-b border-slate-800 pb-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Configuratore Parametri di Flusso Wallbox</h2>
              <p className="text-xs text-slate-500 font-medium flex items-center gap-1.5 mt-1">
                <Info className="h-3.5 w-3.5 text-sky-400" />
                I valori inseriti qui modificano istantaneamente l'algoritmo del simulatore e vengono compilati all'interno dell'esportatore JSON Node-RED.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              
              {/* Box 1: Home Assistant Config */}
              <div className="space-y-4 rounded-xl bg-slate-950 p-5 border border-slate-800 flex flex-col justify-between">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300 border-b border-slate-800/80 pb-2.5">
                  <span className="h-2 w-2 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.5)]"></span>
                  Integrazione API Home Assistant
                </h3>
                
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-1">Indirizzo Server HA</label>
                    <input
                      type="text"
                      value={config.haUrl}
                      onChange={(e) => setConfig({ ...config, haUrl: e.target.value })}
                      className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Entità Controllo Corrente (Ampere)</label>
                    <input
                      type="text"
                      value={config.chargerControlEntity}
                      onChange={(e) => setConfig({ ...config, chargerControlEntity: e.target.value })}
                      className="w-full font-mono rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none text-cyan-400"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Entità Sensore FV (Sorgente Power)</label>
                    <input
                      type="text"
                      value={config.solarPowerEntity}
                      onChange={(e) => setConfig({ ...config, solarPowerEntity: e.target.value })}
                      className="w-full font-mono rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Entità Carichi Casa (Sorgente Meter)</label>
                    <input
                      type="text"
                      value={config.houseConsumptionEntity}
                      onChange={(e) => setConfig({ ...config, houseConsumptionEntity: e.target.value })}
                      className="w-full font-mono rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Entità Pausa / Avvio Ricarica</label>
                    <input
                      type="text"
                      value={config.pauseEntity}
                      onChange={(e) => setConfig({ ...config, pauseEntity: e.target.value })}
                      className="w-full font-mono rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Entità Blocco Sicurezza (Lock)</label>
                    <input
                      type="text"
                      value={config.lockEntity}
                      onChange={(e) => setConfig({ ...config, lockEntity: e.target.value })}
                      className="w-full font-mono rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Box 2: MQTT Config */}
              <div className="space-y-4 rounded-xl bg-slate-950 p-5 border border-slate-800 flex flex-col justify-between">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300 border-b border-slate-800/80 pb-2.5">
                  <span className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]"></span>
                  Connessione MQTT Mosquitto
                </h3>
                
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="text-slate-400 block mb-1">IP Broker MQTT</label>
                      <input
                        type="text"
                        value={config.mqttBrokerHost}
                        onChange={(e) => setConfig({ ...config, mqttBrokerHost: e.target.value })}
                        className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Porta</label>
                      <input
                        type="number"
                        value={config.mqttBrokerPort}
                        onChange={(e) => setConfig({ ...config, mqttBrokerPort: Number(e.target.value) })}
                        className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Topic Impostazione Corrente (A)</label>
                    <input
                      type="text"
                      value={config.mqttCurrentSetTopic}
                      onChange={(e) => setConfig({ ...config, mqttCurrentSetTopic: e.target.value })}
                      className="w-full font-mono rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none text-indigo-400"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Topic Impostazione Pausa (0/1)</label>
                    <input
                      type="text"
                      value={config.mqttPauseSetTopic}
                      onChange={(e) => setConfig({ ...config, mqttPauseSetTopic: e.target.value })}
                      className="w-full font-mono rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-1">Topic Blocco Cavo Security (0/1)</label>
                    <input
                      type="text"
                      value={config.mqttLockSetTopic}
                      onChange={(e) => setConfig({ ...config, mqttLockSetTopic: e.target.value })}
                      className="w-full font-mono rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Box 3: Thresholds, voltage and moving window sizes */}
              <div className="space-y-4 rounded-xl bg-slate-950 p-5 border border-slate-800 flex flex-col justify-between">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300 border-b border-slate-800/80 pb-2.5">
                  <span className="h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"></span>
                  Soglie e Isteresi Algoritmo ECO
                </h3>
                
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Finestra Filtro FV (campioni)</label>
                      <input
                        type="number"
                        min="2"
                        max="20"
                        value={config.sampleWindow}
                        onChange={(e) => setConfig({ ...config, sampleWindow: Number(e.target.value) })}
                        className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Isteresi Tempo Cooldown (sec)</label>
                      <input
                        type="number"
                        step="10"
                        min="20"
                        value={config.hysteresisSeconds}
                        onChange={(e) => setConfig({ ...config, hysteresisSeconds: Number(e.target.value) })}
                        className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Soglia Avvio Carica (W)</label>
                      <input
                        type="number"
                        step="100"
                        value={config.startThresholdWatts}
                        onChange={(e) => setConfig({ ...config, startThresholdWatts: Number(e.target.value) })}
                        className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none font-semibold text-emerald-400"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Soglia Distacco / Stop (W)</label>
                      <input
                        type="number"
                        step="100"
                        value={config.stopThresholdWatts}
                        onChange={(e) => setConfig({ ...config, stopThresholdWatts: Number(e.target.value) })}
                        className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none font-semibold text-red-400"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Corrente Minima (Ampere)</label>
                      <input
                        type="number"
                        min="6"
                        value={config.minChargeCurrent}
                        onChange={(e) => setConfig({ ...config, minChargeCurrent: Number(e.target.value) })}
                        className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Corrente Massima (Ampere)</label>
                      <input
                        type="number"
                        max="32"
                        value={config.maxChargeCurrent}
                        onChange={(e) => setConfig({ ...config, maxChargeCurrent: Number(e.target.value) })}
                        className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-slate-400 block mb-1">Tensione di Rete (Volt)</label>
                      <input
                        type="number"
                        value={config.singlePhaseVoltage}
                        onChange={(e) => setConfig({ ...config, singlePhaseVoltage: Number(e.target.value) })}
                        className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-slate-400 block mb-1">Moltiplicatore Fasi</label>
                      <select
                        value={config.pvMultiplier}
                        onChange={(e) => setConfig({ ...config, pvMultiplier: Number(e.target.value) })}
                        className="w-full rounded bg-slate-950 p-2 border border-slate-800 focus:border-cyan-400 focus:outline-none"
                      >
                        <option value={1}>Monofase (x1)</option>
                        <option value={3}>Trifase (x3)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Save notice */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-xl bg-emerald-500/5 p-4 border border-emerald-500/10 text-xs text-slate-300">
              <span className="flex items-center gap-2.5 text-emerald-400 font-medium">
                <Check className="h-4 w-4 shadow-[0_0_8px_rgba(16,185,129,0.3)]" />
                <span>Parametri sincronizzati in tempo reale. Le modifiche sono state compilate nell'esportatore JSON.</span>
              </span>
              <button
                onClick={() => setConfig(INITIAL_CONFIG)}
                className="font-bold text-emerald-400 uppercase tracking-widest text-[10px] hover:text-emerald-300 hover:underline transition-all duration-200 shrink-0"
              >
                Ripristina Defaults
              </button>
            </div>
          </div>
        )}

        {/* ========================================================
            TAB 4: JSON NODE-RED FLOW EXPORTER
            ======================================================== */}
        {activeTab === "json" && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg">
              <div className="mb-6 flex flex-col justify-between gap-4 border-b border-slate-800 pb-4 sm:flex-row sm:items-center">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Flusso Node-RED Completo Prontissimo All'Uso</h2>
                  <p className="text-xs text-slate-500 font-medium mt-1">
                    Copia il codice sottostante e incollalo tramite la voce <strong>Import</strong> nel menu principale del tuo Node-RED.
                  </p>
                </div>
                
                <button
                  onClick={copyToClipboard}
                  className="flex items-center gap-2 rounded-lg bg-sky-500 hover:bg-sky-400 px-4 py-2 text-xs font-bold uppercase tracking-widest text-slate-950 shadow-md shadow-sky-500/10 transition-all duration-200"
                >
                  {copiedCode ? (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Copiato negli Appunti!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      <span>Copia Codice JSON</span>
                    </>
                  )
                }
                </button>
              </div>

              {/* Code window */}
              <div className="relative">
                <pre className="max-h-[500px] overflow-y-auto rounded-lg bg-slate-950 p-5 font-mono text-xs text-emerald-400 border border-slate-800 select-all leading-relaxed whitespace-pre">
                  {nodeRedJsonString}
                </pre>
                <div className="absolute top-3 right-3 rounded bg-slate-900 px-2.5 py-1 text-[9px] uppercase font-bold tracking-wider text-slate-500 border border-slate-800 select-none">
                  node-red JSON format (UTF-8)
                </div>
              </div>
            </div>

            {/* Code import details */}
            <div className="rounded-xl border border-slate-805 border-slate-800 bg-slate-950 p-5 text-sm leading-relaxed space-y-3 shadow-lg">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-300">Come importare questo flusso nel tuo impianto Node-RED:</h3>
              <ol className="list-decimal pl-5 space-y-2 text-slate-300 text-xs">
                <li>Clicca sul pulsante azzurro <strong>Copia Codice JSON</strong> qui sopra.</li>
                <li>Nel tuo browser, accedi alla dashboard di Node-RED (di solito parte dell'add-on di Home Assistant).</li>
                <li>Fai clic sul pulsante del menu nell'angolo in alto a destra (icona con tre righe orizzontali).</li>
                <li>Seleziona <strong>Import</strong>.</li>
                <li>Incolla il codice nella casella di testo premendo <kbd className="bg-slate-800 px-1 rounded">Ctrl+V</kbd> (o <kbd className="bg-slate-800 px-1 rounded">Cmd+V</kbd> su Mac).</li>
                <li>Seleziona <strong>Selected Tab</strong> o <strong>New Tab</strong> e clicca sul pulsante rosso <strong>Import</strong>.</li>
                <li>Clicca sul pulsante rosso <strong>Deploy</strong> in alto a destra per caricare il flusso sul server.</li>
              </ol>
            </div>
          </div>
        )}

        {/* ========================================================
            TAB 5: DETAILED GUIDE & TESTING MANUAL (AND AI CONSULTANT)
            ======================================================== */}
        {activeTab === "guide" && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            
            {/* Guide documentation index (Col 1 to 7) */}
            <div className="space-y-6 lg:col-span-7">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg space-y-6 text-slate-300 leading-relaxed text-sm select-text">
                
                <div className="border-b border-slate-800 pb-3">
                  <h2 className="text-xl font-bold tracking-tight text-white font-display">Guida alla Configurazione: Flusso di Ricarica Doppia Ridondanza</h2>
                  <p className="text-xs text-slate-400">Scritto per Wallbox Pulsar Max • Integrazione HA e Mosquitto MQTT</p>
                </div>

                {/* Section 1: Redundancy logic */}
                <section className="space-y-3">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-cyan-500/10 text-xs text-cyan-400">1</span>
                    Architettura del Flusso (API + MQTT)
                  </h3>
                  <p>
                    La Wallbox Pulsar Max supporta due interfacce di comunicazione:
                  </p>
                  <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300 pr-2">
                    <li>
                      <strong className="text-cyan-400">REST API / Cloud Integration:</strong> Facile da configurare, fornisce letture complete ma ha lo svantaggio critico del <em>rate limiting</em> impostato da Wallbox (fino a un massimo di poche decine di scritte giornaliere). Inviare comandi di modulazione ogni minuto causa il blocco temporaneo dell'account.
                    </li>
                    <li>
                      <strong className="text-indigo-400">MQTT Locale (Broker Mosquitto):</strong> Comunica direttamente tramite la rete locale LAN con tempi di millisecondi senza dipendere dal cloud e senza limiti di scrittura. Tuttavia, se il broker cede o si sconnette, la Wallbox rimane priva di carichi.
                    </li>
                  </ul>
                  <p className="bg-slate-900/60 p-3 rounded-lg border border-slate-800/80 text-xs text-slate-400 leading-snug">
                    <strong className="text-emerald-400">Il nostro approccio Dual-Path:</strong> Il nodo <strong className="text-slate-200">"Routing Switch"</strong> invia comandi paralleli a entrambe le interfacce o permette lo sbilanciamento di emergenza in caso di anomalia. Se la rete cloud fallisce o il broker Mosquitto locale crasha, l'altra via mantiene in sicurezza la modulazione dell'auto.
                  </p>
                </section>

                {/* Section 2: Moving average smoothing */}
                <section className="space-y-3 border-t border-slate-800 pt-5">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-cyan-500/10 text-xs text-cyan-400">2</span>
                    Filtro Anti-Rimbalzo e Smoothing FV
                  </h3>
                  <p>
                    La produzione solare fluttua rapidamente a causa del vento e di nuvole temporanee. Se la Wallbox seguisse la variazione istantanea dei pannelli, i teleruttori interni subirebbero carichi ripetitivi nocivi che danneggerebbero il veicolo e la Wallbox.
                  </p>
                  <p>
                    Utilizziamo due barriere matematiche:
                  </p>
                  <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300 pr-2">
                    <li>
                      <strong className="text-amber-400">Media Mobile (Smoothing):</strong> Memorizziamo una finestra di 5-10 letture (e.g., nodo <code className="bg-slate-800 px-1 rounded text-cyan-400">node_calc_reduction</code>). Le fluttuazioni inferiori a pochi minuti vengono filtrate, creando una linea di surplus "morbida" ed elastica.
                    </li>
                    <li>
                      <strong className="text-orange-400">Isteresi e Rate Throttling:</strong> Un tempo minimo di attesa (es. 300 secondi) impedisce alla Wallbox di passare continuativamente da START a PAUSA. Solo gli arresti di emergenza scavalcano questa barriera.
                    </li>
                  </ul>
                </section>

                {/* Section 3: testing fallback */}
                <section className="space-y-3 border-t border-slate-800 pt-5">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded bg-cyan-500/10 text-xs text-cyan-400">3</span>
                    Come Verificare ed Eseguire Test di Backup
                  </h3>
                  <p>
                    Nel pannello <strong>Dashboard</strong>, puoi simulare i guasti per assicurarti che la doppia ridondanza protegga il tuo veicolo:
                  </p>
                  <ol className="list-decimal pl-5 space-y-2 text-xs text-slate-400">
                    <li>
                      Imposta il routing in <strong className="text-indigo-400">PARALLELO</strong> nella Dashboard.
                    </li>
                    <li>
                      Fai clic sul pulsante rosso <strong className="text-red-400">Spengi API HA</strong> per disattivare l'integrazione di HA.
                    </li>
                    <li>
                      Muovi lo slider di produzione FV. Noterai nel logger che le chiamate API segnalano un errore (<span className="text-red-400 font-bold">FALLITO</span>), ma la Wallbox riceve continuativamente i comandi di regolazione della potenza tramite <strong className="text-indigo-400 font-bold">MQTT Publish</strong> senza un solo micro-secondo di stop!
                    </li>
                  </ol>
                </section>

              </div>
            </div>

            {/* AI Assistant Chat Panel (Col 8 to 12) */}
            <div className="space-y-6 lg:col-span-5">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col h-[580px] justify-between">
                <div>
                  <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-sky-400 shadow-[0_0_8px_rgba(14,165,233,0.3)]" />
                      <h2 className="text-sm font-bold uppercase tracking-widest text-slate-300">Consulente AI Home Assistant</h2>
                    </div>
                    <span className="rounded bg-emerald-500/10 border border-emerald-500/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400">Gemini Active</span>
                  </div>

                  {/* Messages container */}
                  <div className="h-[380px] overflow-y-auto rounded-xl bg-slate-950 p-4 border border-slate-800 scroll-smooth space-y-4">
                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-xs select-text ${
                            msg.sender === "user"
                              ? "bg-sky-500 text-slate-950 font-bold rounded-br-none shadow-[0_0_8px_rgba(14,165,233,0.2)]"
                              : "bg-slate-900 text-slate-300 border border-slate-800 rounded-bl-none leading-relaxed font-medium"
                          }`}
                        >
                          {msg.text}
                        </div>
                        <span className="text-[9px] text-slate-500 mt-1 select-none">
                          {msg.sender === "user" ? "Tu" : "AI Senior Advisor"}
                        </span>
                      </div>
                    ))}
                    {chatLoading && (
                      <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-400" />
                        <span>L'esperto sta elaborando la risposta tecnica...</span>
                      </div>
                    )}
                    <div ref={chatEndRef}></div>
                  </div>
                </div>

                {/* Question Input form */}
                <form onSubmit={handleSendMessage} className="mt-4 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={chatLoading}
                    placeholder="Chiedimi consigli o debug su YAML / MQTT..."
                    className="flex-1 rounded-lg bg-slate-950 p-2.5 text-xs border border-slate-800 text-slate-200 focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30 focus:outline-none placeholder:text-slate-600 font-medium"
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatInput.trim()}
                    className="rounded-lg bg-sky-500 p-2.5 hover:bg-sky-450 text-slate-950 hover:shadow-[0_0_12px_rgba(14,165,233,0.3)] transition-all duration-200 disabled:opacity-30 disabled:shadow-none"
                  >
                    <Send className="h-4 w-4 stroke-[2.5]" />
                  </button>
                </form>

              </div>
            </div>

          </div>
        )}

      </main>

      {/* FOOTER BAR */}
      <footer className="mt-16 border-t border-slate-900 bg-slate-950 py-8 text-center text-xs text-slate-500">
        <div className="mx-auto max-w-5xl px-4 space-y-2">
          <p>© 2026 Wallbox Pulsar Max Node-RED Controller • Built for Home Assistant OS</p>
          <p className="px-12 leading-relaxed text-[11px] text-slate-600 select-text">
            N.B. L'architettura a doppia via si basa su un collegamento simultaneo RESTful HTTP/CoAP e MQTT. Assicurati che l'account Wallbox Cloud rimanga autenticato e che la rete locale Mosquitto non esegua blocchi ACL sulle credenziali del nodo Node-RED.
          </p>
        </div>
      </footer>

    </div>
  );
}
