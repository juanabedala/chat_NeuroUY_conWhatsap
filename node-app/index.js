const express = require("express");
const qrcode = require("qrcode");
const fetch = require("node-fetch");
const { Client, RemoteAuth } = require("whatsapp-web.js");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- WhatsApp ----------
let qrDataUrl = null;

const wa = new Client({
    authStrategy: new RemoteAuth({
        clientId: "bot1", // identificador único del bot
        backupSyncIntervalMs: 60000 // opcional, sincroniza cada 30s
    }),
    puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }
});

wa.on("qr", async (qr) => {
  console.log("QR generado. Abrí la URL del servicio para escanearlo.");
  qrDataUrl = await qrcode.toDataURL(qr);
});

wa.on("ready", () => {
  console.log("✅ WhatsApp conectado");
  qrDataUrl = null; // ya no hace falta mostrarlo
});

wa.on("authenticated", () => {
    console.log("✅ Sesión autenticada correctamente");
});

wa.on("auth_failure", msg => {
    console.error("❌ Error de autenticación:", msg);
});

wa.on("message", async (msg) => {
  try {
    const pregunta = msg.body?.trim();
    if (!pregunta) return;

    // 1) Buscar contexto en el microservicio Python (FAISS)
    const pyUrl = process.env.PY_SERVICE_URL?.replace(/\/+$/, "");
    const url = `${pyUrl}/search?q=${encodeURIComponent(pregunta)}&k=5`;
    const resp = await fetch(url);
    const data = await resp.json();

    const contexto = Array.isArray(data?.resultados) ? data.resultados : [];
    const contextoPlano = contexto.map((c, i) => `(${i + 1}) ${typeof c === "string" ? c : JSON.stringify(c)}`).join("\n");

    // 2) Preguntar a Gemini con ese contexto
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    const prompt = `Usá el siguiente contexto para responder la pregunta del usuario, si no encuentras la respuesta intenta responderla tú,
ten en cuenta que somos una empresa de TI que soluciona problemas a la industria y al agro.

Contexto recuperado (relevante, puede tener ruido):
${contextoPlano}

Pregunta del usuario:
"${pregunta}"


Instrucciones:
- Responde en en el idioma que esta la pregunta, claro y conciso, no mas de 10 líneas.`;


/*
const prompt = `Usá el siguiente contexto para responder la pregunta del usuario, si no encuentras la respuesta intenta responderla tú,
ten en cuenta que somos una empresa de TI que soluciona problemas a la industria y al agro.

Contexto recuperado (relevante, puede tener ruido):
${contextoPlano}

Pregunta del usuario:
${pregunta}`;
*/



    const result = await model.generateContent(prompt);
    const texto = result?.response?.text?.() || "No tengo respuesta disponible.";
    await msg.reply(texto);
  } catch (err) {
    console.error("Error al procesar mensaje:", err);
    await msg.reply("⚠️ Ocurrió un error al procesar tu consulta.");
  }
});

// ---------- Express (mostrar QR / health) ----------
app.get("/", (req, res) => {
  if (qrDataUrl) {
    res.send(`<h2>Escaneá este QR con WhatsApp Business</h2><img src="${qrDataUrl}" style="max-width:340px;">`);
  } else {
    res.send("Bot WhatsApp activo ✅ (si no estás conectado aún, espera a que se genere el QR)");
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`🌐 Node escuchando en :${PORT}`);
});

wa.initialize();
