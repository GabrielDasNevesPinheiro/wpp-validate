import { makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { Boom } from "@hapi/boom";
import express from "express";
import { config } from "dotenv";

config();

// ====================== CONFIGURAÇÕES ======================
let sock;
let isAuth = false;

const app = express();
app.use(express.json());

// ====================== LÓGICA DE VALIDAÇÃO ======================

/**
 * Valida se um número existe no WhatsApp
 * @param {string} numero 
 * @param {number} retries 
 */
const validateWhatsapp = async (numero, retries = 3) => {
    let attempt = 0;
    while (attempt < retries) {
        try {
            // Formata o JID (55 + número + sufixo do WhatsApp)
            const jid = `55${numero.replace(/\D/g, "")}@s.whatsapp.net`;
            
            // O método onWhatsApp verifica a existência do JID nos servidores
            const response = await sock.onWhatsApp(jid);
            return response?.[0]?.exists || false;
        } catch (err) {
            attempt++;
            // Delay exponencial simples em caso de erro de conexão
            await new Promise(res => setTimeout(res, 2000 * attempt));
        }
    }
    return false;
};

// ====================== ROTAS API ======================

app.post("/verificar-bulk", async (req, res) => {
    if (!isAuth) {
        return res.status(503).json({ erro: "WhatsApp não autenticado" });
    }

    const { numeros } = req.body;
    if (!Array.isArray(numeros)) {
        return res.status(400).json({ erro: "Envie um array de números no campo 'numeros'" });
    }

    const results = [];
    for (const numero of numeros) {
        const status = await validateWhatsapp(numero);
        results.push({ numero, whatsapp: status });
    }

    return res.json(results);
});

app.get("/health_check", (req, res) => {
    res.status(isAuth ? 200 : 503).json({ 
        status: isAuth ? "Online" : "Offline",
        timestamp: new Date()
    });
});

// ====================== INICIALIZAÇÃO WHATSAPP (BAILEYS) ======================

const startBot = async (sessionName = "default") => {
    const { state, saveCreds } = await useMultiFileAuthState(`sessions/${sessionName}`);
    
    sock = makeWASocket({ 
        auth: state, 
        printQRInTerminal: false, 
        version: [2, 3000, 1033893291], // Versão estável
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            console.log("📌 Escaneie o QR Code abaixo:");
            qrcode.generate(qr, { small: true });
        }

        if (connection === "open") {
            console.log("✅ WhatsApp Conectado com sucesso!");
            isAuth = true;
        }

        if (connection === "close") {
            const shouldReconnect = new Boom(lastDisconnect?.error)?.output?.statusCode !== 401;
            isAuth = false;
            console.log("❌ Conexão fechada. Reconectando:", shouldReconnect);
            if (shouldReconnect) startBot(sessionName);
        }
    });
};

// ====================== START SERVER ======================

const PORT = process.env.PORT || 3200;

app.listen(PORT, async () => {
    console.log(`🚀 API de Validação rodando na porta ${PORT}`);
    try {
        await startBot(process.env.SESSION_NAME || "default");
    } catch (err) {
        console.error("Erro ao iniciar o Bot:", err);
    }
});
