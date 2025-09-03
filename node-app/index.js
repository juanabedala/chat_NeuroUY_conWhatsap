const express = require("express");
const qrcode = require("qrcode");
const fetch = require("node-fetch");
const { Client, RemoteAuth } = require("whatsapp-web.js");
const mysql = require("mysql2/promise");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- MySQL Store para RemoteAuth ----------
const pool = mysql.createPool({
  host: "www.neuro.uy",
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: "neuro_bddigital",
});

const MySQLStore = {
  async save({ session, data }) {
    if (!data) return; // Ignora los intentos con null
    const jsonData = JSON.stringify(data);
    await pool.query(
      "INSERT INTO wa_session (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?",
      [session, jsonData, jsonData]
    );
    console.log("💾 Sesión guardada:", session);
  },

  async load({ session }) {
    const [rows] = await pool.query("SELECT data FROM wa_session WHERE id = ?", [session]);
    if (rows.length && rows[0].data) return JSON.parse(rows[0].data);
    return null;
  },

  async remove({ session }) {
    await pool.query("DELETE FROM wa_session WHERE id = ?", [session]);
  },

  async sessionExists({ session }) {
    const [rows] = await pool.query("SELECT 1 FROM wa_session WHERE id = ?", [session]);
    return rows.length > 0;
  }
};

// ---------- WhatsApp ----------
let qrDataUrl = null;

const wa = new Client({
  authStrategy: new RemoteAuth({
    clientId: "bot1",
    backupSyncIntervalMs: 60000, // 1 minuto mínimo
    store: MySQLStore
  }),
  puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }
});

wa.on("qr", async (qr) => {
  console.log("QR generado. Escanealo con WhatsApp Business.");
  qrDataUrl = await qrcode.toDataURL(qr);
});

wa.on("ready", () => {
  console.log("✅ WhatsApp conectado");
  qrDataUrl = null;
});

wa.on("authenticated", async (session) => {
  console.log("✅ Sesión autenticada correctamente");

  // Guardar manualmente en la base
  if (session) {
    await MySQLStore.save({ session: "RemoteAuth-bot1", data: session });
    console.log("💾 Sesión guardada manualmente en la base");
  }
});

wa.on("auth_failure", msg => {
  console.error("❌ Error de autenticación:", msg);
});

wa.on("message", async (msg) => {
  console.log("🔹 Mensaje recibido:", msg.body);
  try {
    const pregunta = msg.body?.trim();
    if (!pregunta) return;

    // 1) Buscar contexto en el microservicio Python (FAISS)
    const pyUrl = process.env.PY_SERVICE_URL?.replace(/\/+$/, "");
    const url = `${pyUrl}/search?q=${encodeURIComponent(pregunta)}&k=5`;
    const resp = await fetch(url);
    const data = await resp.json();

    const contexto = Array.isArray(data?.resultados) ? data.resultados : [];
    const contextoPlano = contexto.map((c, i) => `(${i + 1}) ${c}`).join("\n");

    // 2) Preguntar a Gemini con ese contexto
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Usá el siguiente contexto para responder la pregunta del usuario, si no encuentras la respuesta intenta responderla tú,
ten en cuenta que somos una empresa de TI que soluciona problemas a la industria y al agro.

Contexto recuperado (relevante, puede tener ruido):
${contextoPlano}

Pregunta del usuario:
"${pregunta}"


Instrucciones:
- Responde en en el idioma que esta la pregunta, claro y conciso, no mas de 10 líneas.`;

    const result = await model.generateContent(prompt);
    const texto = result?.response?.text?.() || "No tengo respuesta disponible.";

    
    pool.query(
      "INSERT INTO wa_logs (user_number, message, response) VALUES (?, ?, ?)",
      ["bot1", pregunta, texto],
      
    );

    
    await msg.reply(texto);
  } catch (err) {
    console.error("Error al procesar mensaje:", err);
    await msg.reply("⚠️ Ocurrió un error al procesar tu consulta.");
  }
});

// ---------- Express ----------
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

