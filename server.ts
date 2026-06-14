import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini SDK with telemetry header
const geminiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (geminiKey) {
  ai = new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// AI Companion Endpoint
app.post("/api/gemini/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Il messaggio è obbligatorio." });
    }

    if (!ai) {
      return res.status(500).json({
        error: "Il servizio Gemini non è configurato. Assicurati che la chiave GEMINI_API_KEY sia impostata nei Segreti.",
      });
    }

    const systemInstruction = `Sei un esperto Senior di Domotica, Home Assistant (HAOS), protocollo MQTT e Node-RED con focus speciale sulla gestione dei carichi e sulla ricarica EV con Wallbox Pulsar Max.
Fornisci risposte accurate, tecniche, strutturate e facili da comprendere. Parla in italiano.
Aiuta l'utente a configurare il flusso Node-RED, debuggare sensori, impostare correttamente i broker MQTT come Mosquitto, i servizi di Home Assistant (p.es. number.set_value, switch.turn_on) e rispondi a dubbi sulla logica a doppia ridondanza (Dual-Path) e sul calcolo del Surplus di produzione FV (Smoothing con media mobile, isteresi temporale).
Fornisci soluzioni pratiche e, quando opportuno, snippet di codice Javascript per i nodi del tipo 'Function' nel formato corretto di Node-RED (msg.payload).`;

    // Format chat history
    const contents = history ? [...history, { role: "user", parts: [{ text: message }] }] : message;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    const reply = response.text || "Nessuna risposta generata dal modello.";
    res.json({ text: reply });
  } catch (error: any) {
    console.error("Errore nel recupero della chat Gemini:", error);
    res.status(500).json({ error: error.message || "Errore interno durante l'elaborazione." });
  }
});

// Configure Vite or Serve Static Files
async function start() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Inizializzazione Vite in modalità middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server avviato correttamente su http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Errore durante l'avvio del server:", err);
});
