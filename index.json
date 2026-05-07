const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const pino = require('pino');
const express = require('express');
const mongoose = require('mongoose');
const axios = require('axios');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
app.use(express.urlencoded({ extended: true }));

// ---------------- SYSTEM GUARDS ----------------
process.on('uncaughtException', (err) => console.log('⚠️ Error:', err.message));
process.on('unhandledRejection', (err) => console.log('⚠️ Rejection:', err.message));

// ---------------- CONFIG ----------------
const OWNER_NUMBER = "2347051768946";
const BOT_NAME = "JARVIS AI";
const POWERED_BY = "Flexi Digital Academy";

// ---------------- DATABASE ----------------
const WarnSchema = new mongoose.Schema({ userId: String, count: Number });
const ConfigSchema = new mongoose.Schema({ keyName: String, keyValue: String });

const Warn = mongoose.model('Warn', WarnSchema);
const Config = mongoose.model('Config', ConfigSchema);

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ DB Error:", err));

// ---------------- AI FUNCTION ----------------
async function askAI(prompt) {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return "🤖 Missing API key";

        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                contents: [
                    { parts: [{ text: prompt }] }
                ]
            }
        );

        return res.data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
    } catch {
        return "⚠️ AI error";
    }
}

// ---------------- BOT STATE ----------------
let sock;

// ---------------- START BOT ----------------
async function startJARVIS() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const shouldReconnect =
                (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) startJARVIS();
        }

        if (connection === 'open') {
            console.log(`✅ ${BOT_NAME} ONLINE`);
        }
    });

    // ---------------- GROUP WELCOME + GOODBYE ----------------
    sock.ev.on('group-participants.update', async (anu) => {
        try {
            const metadata = await sock.groupMetadata(anu.id);

            for (const num of anu.participants) {
                const user = num.split('@')[0];

                if (anu.action === 'add') {
                    await sock.sendMessage(anu.id, {
                        text: `👋 Welcome @${user} to *${metadata.subject}* 🚀`,
                        mentions: [num]
                    });
                }

                if (anu.action === 'remove') {
                    await sock.sendMessage(anu.id, {
                        text: `👋 Goodbye @${user}, we wish you success 🎓`,
                        mentions: [num]
                    });
                }
            }
        } catch (err) {
            console.log("Group error:", err);
        }
    });

    // ---------------- MESSAGE HANDLER ----------------
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const sender = m.key.participant || jid;

        const body =
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            "";

        const text = body.trim().toLowerCase();

        const command = text.split(" ")[0];
        const args = body.split(" ").slice(1);

        let isOwner = sender.includes(OWNER_NUMBER);
        let isStaff = isOwner;

        // ---------------- AI COMMAND ----------------
        if (command === "!ai" && isStaff) {
            const prompt = args.join(" ");
            const reply = await askAI(prompt);

            return sock.sendMessage(jid, {
                text: `🤖 JARVIS AI\n\n${reply}`
            });
        }

        // ---------------- ADD MEMBER ----------------
        if (command === "!add" && isStaff) {
            try {
                let target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];

                if (!target && args[0]) {
                    const num = args[0].replace(/[^0-9]/g, '');
                    target = num + "@s.whatsapp.net";
                }

                if (!target) {
                    return sock.sendMessage(jid, { text: "❌ Provide number or mention" });
                }

                await sock.groupParticipantsUpdate(jid, [target], "add");

                return sock.sendMessage(jid, {
                    text: "✅ User added"
                });

            } catch {
                return sock.sendMessage(jid, {
                    text: "❌ Failed (check admin rights)"
                });
            }
        }
    });
}

// ---------------- DASHBOARD UI ----------------
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
<title>JARVIS AI Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { font-family: Arial; background:#0f172a; color:white; text-align:center; }
.container { max-width:500px; margin:auto; padding:20px; }
.card { background:#1e293b; padding:20px; margin:20px 0; border-radius:10px; }
input { width:100%; padding:10px; margin-top:10px; }
button { width:100%; padding:10px; background:#2563eb; color:white; border:none; margin-top:10px; }
.code { margin-top:10px; padding:10px; border:1px dashed #38bdf8; }
</style>
</head>

<body>

<h2>🤖 JARVIS AI PAIRING DASHBOARD</h2>

<div class="container">

<div class="card">
<h3>Generate Pairing Code</h3>
<input id="number" placeholder="234XXXXXXXXXX">
<button onclick="pair()">Generate</button>
<div class="code" id="code">---</div>
</div>

<div class="card">
<h3>Update AI Key</h3>
<input id="key" placeholder="Gemini API Key">
<button onclick="save()">Save</button>
<p id="msg"></p>
</div>

</div>

<script>
async function pair() {
    const num = document.getElementById('number').value;
    document.getElementById('code').innerText = "Loading...";

    const res = await fetch('/pair?number=' + num);
    const data = await res.text();

    document.getElementById('code').innerText = data;
}

async function save() {
    const key = document.getElementById('key').value;

    const res = await fetch('/update-key?key=' + key);
    document.getElementById('msg').innerText = await res.text();
}
</script>

</body>
</html>
    `);
});

// ---------------- PAIRING ----------------
app.get('/pair', async (req, res) => {
    const number = req.query.number?.replace(/[^0-9]/g, '');
    if (!sock) return res.send("Bot starting...");

    try {
        const code = await sock.requestPairingCode(number);
        res.send(code);
    } catch {
        res.send("Error generating code");
    }
});

// ---------------- SAVE KEY ----------------
app.get('/update-key', async (req, res) => {
    await Config.findOneAndUpdate(
        { keyName: 'GEMINI_API_KEY' },
        { keyValue: req.query.key },
        { upsert: true }
    );

    res.send("✅ Key Saved");
});

// ---------------- START SERVER ----------------
app.listen(port, () => startJARVIS());
