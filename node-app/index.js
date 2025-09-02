require("dotenv").config();
const express = require("express");
const { Client, RemoteAuth } = require("whatsapp-web.js");
const { MySQLStore } = require("wwebjs-mysql");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// 🚀 Configuración de MySQL
const store = new MySQLStore({
  host: "www.neuro.uy", // Cambiar si tu hosting da otra URL interna
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: "neuro_bddigital",
});

// 🚀 Configuración de WhatsApp
const wa = new Client({
  authStrategy: new RemoteAuth({
    clientId: "bot1",
    store,
    backupSyncIntervalMs: 60000,
  }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// 🚀 Configuración de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// ✅ Logs de estado
wa.on("qr", (qr) => {
  console.log("🔑 Escanea este QR con tu WhatsApp Web:");
  console.log(qr);
});

wa.on("ready", () => {
  console.log("✅ WhatsApp conectado y listo para recibir mensajes");
});

wa.on("authenticated", () => {
  console.log("🔒 Sesión autenticada correctamente");
});

wa.on("disconnected", (reason) => {
  console.log("❌ Cliente desconectado:", reason);
});

// 🚀 Listener de mensajes
wa.on("message", async (msg) => {
  console.log("📩 Mensaje recibido:", msg.body);

  try {
    // 1️⃣ Enviar mensaje a Gemini
    const result = await model.generateContent(msg.body);
    const response = result.response.text();

    // 2️⃣ Responder en WhatsApp
    await msg.reply(response);

    // 3️⃣ Guardar en MySQL (opcional)
    store.query(
      "INSERT INTO wa_logs (user_number, message, response) VALUES (?, ?, ?)",
      [msg.from, msg.body, response],
      (err) => {
        if (err) console.error("❌ Error guardando en MySQL:", err);
      }
    );
  } catch (error) {
    console.error("⚠️ Error al consultar Gemini:", error);
    await msg.reply("Lo siento, hubo un error al procesar tu mensaje 🙏");
  }
});

// 🚀 Inicializar cliente WhatsApp
wa.initialize();

// 🚀 Servidor Express
app.get("/", (req, res) => {
  res.send("✅ Bot de WhatsApp corriendo en Railway con Gemini");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server escuchando en puerto ${PORT}`));
