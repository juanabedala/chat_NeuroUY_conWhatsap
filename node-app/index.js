import express from "express";
import qrcode from "qrcode";
import fetch from "node-fetch";
import { Client, RemoteAuth } from "whatsapp-web.js";
import mysql from "mysql2/promise";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- MySQL Store para RemoteAuth ----------
const pool = mysql.createPool({
  host: "www.neuro.uy",
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: "neuro_bddigital",
});

// La clase completa de MySQLStore
class MySQLStore {
  constructor(pool) {
    this.pool = pool;
  }

  // Check if a session exists in the database
  async sessionExists(session) {
    try {
      // Corrected query: using '?' placeholder for the session ID
      const [rows] = await this.pool.query(
        "SELECT 1 FROM wa_session WHERE id = ?",
        [session]
      );
      return rows.length > 0;
    } catch (error) {
      console.error("Error in sessionExists:", error);
      return false; // Return false on error
    }
  }

  // Restore the session data from the database
  async restore(session) {
    try {
      const [rows] = await this.pool.query(
        "SELECT data FROM wa_session WHERE id = ?",
        [session]
      );
      if (rows.length && rows[0].data) {
        return JSON.parse(rows[0].data);
      }
      return null;
    } catch (error) {
      console.error("Error in restore:", error);
      return null;
    }
  }

  // Save or update the session data
  async save(session, data) {
    try {
      const jsonData = JSON.stringify(data);
      await this.pool.query(
        "INSERT INTO wa_session (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = ?",
        [session, jsonData, jsonData]
      );
      console.log("💾 Session saved:", session);
    } catch (error) {
      console.error("Error in save:", error);
    }
  }

  // Delete the session from the database
  async delete(session) {
    try {
      await this.pool.query("DELETE FROM wa_session WHERE id = ?", [session]);
      console.log("🗑️ Session deleted:", session);
    } catch (error) {
      console.error("Error in delete:", error);
    }
  }
}


// ---------- WhatsApp ----------
let qrDataUrl = null;

// Crea una instancia de tu Store
const store = new MySQLStore(pool);

const wa = new Client({
  authStrategy: new RemoteAuth({
    clientId: "bot1",
    backupSyncIntervalMs: 60000,
    store: store, // Pasa la instancia de la clase
  }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

wa.on("qr", async (qr) => {
  console.log("QR generado. Escanealo con WhatsApp Business.");
  qrDataUrl = await qrcode.toDataURL(qr);
});

wa.on("ready", async () => {
  console.log("✅ WhatsApp conectado");
  qrDataUrl = null;
 
});

wa.on("authenticated", async () => {
  console.log("✅ Sesión autenticada correctamente");

  
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

