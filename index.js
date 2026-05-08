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

// ---------------- CONFIG ----------------
const OWNER_NUMBER = "2347051768946";
const BOT_NAME = "JARVIS AI";

// ---------------- DB ----------------
const WarnSchema = new mongoose.Schema({
    userId: String,
    count: Number
});

const ConfigSchema = new mongoose.Schema({
    keyName: String,
    keyValue: String
});

const Warn = mongoose.model('Warn', WarnSchema);
const Config = mongoose.model('Config', ConfigSchema);

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.log("❌ DB Error:", err));

// ---------------- AI ----------------
async function askAI(prompt) {
    try {
        const dbConfig = await Config.findOne({ keyName: 'GEMINI_API_KEY' });
        const apiKey = dbConfig?.keyValue || process.env.GEMINI_API_KEY;

        if (!apiKey) return "❌ AI key missing in dashboard";

        const res = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                contents: [{ parts: [{ text: prompt }] }]
            }
        );

        return res.data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
    } catch (err) {
        console.log(err.message);
        return "⚠️ AI error / invalid key";
    }
}

let sock;
const activityTracker = new Map();

// ---------------- BOT START ----------------
async function startJARVIS() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: 'silent' }),
        browser: ["JARVIS", "Chrome", "1.0"]
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
            console.log("🤖 JARVIS ONLINE");
        }
    });

    // ---------------- WELCOME / GOODBYE ----------------
    sock.ev.on('group-participants.update', async (update) => {
        try {
            const meta = await sock.groupMetadata(update.id);
            const groupName = meta.subject;

            for (const user of update.participants) {
                const name = user.split('@')[0];

                if (update.action === 'add') {
                    await sock.sendMessage(update.id, {
                        text: `👋 Welcome @${name} to *${groupName}* 🤖`,
                        mentions: [user]
                    });
                }

                if (update.action === 'remove') {
                    await sock.sendMessage(update.id, {
                        text: `👋 Goodbye @${name} from *${groupName}* ❤️`,
                        mentions: [user]
                    });
                }
            }
        } catch (e) {
            console.log("Group error:", e.message);
        }
    });

    // ---------------- MESSAGES ----------------
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const jid = m.key.remoteJid;
        const sender = m.key.participant || jid;

        const text =
            m.message.conversation ||
            m.message.extendedTextMessage?.text ||
            "";

        const body = text.trim();
        const lower = body.toLowerCase();

        activityTracker.set(sender, Date.now());

        // react
        if (lower.includes("jarvis")) {
            await sock.sendMessage(jid, {
                react: { text: "🤖", key: m.key }
            });
        }

        const isOwner = sender.split('@')[0] === OWNER_NUMBER;
        let isAdmin = isOwner;

        let metadata;
        if (jid.endsWith("@g.us")) {
            metadata = await sock.groupMetadata(jid);

            const admins = metadata.participants
                .filter(p => p.admin !== null)
                .map(p => p.id);

            isAdmin = isOwner || admins.includes(sender);
        }

        const command = body.split(" ")[0];
        const args = body.split(" ").slice(1);

        // ---------------- AI ----------------
        if (command === "!ai") {
            const prompt = args.join(" ");
            if (!prompt) return sock.sendMessage(jid, { text: "Ask something" });

            await sock.sendPresenceUpdate('composing', jid);
            const reply = await askAI(prompt);

            return sock.sendMessage(jid, {
                text: `🤖 JARVIS AI:\n\n${reply}`
            });
        }

        if (!isAdmin) return;

        // ---------------- ADMIN COMMANDS ----------------
        if (command === "!mute") {
            await sock.groupSettingUpdate(jid, 'announcement');
            return sock.sendMessage(jid, { text: "🔒 Muted" });
        }

        if (command === "!unmute") {
            await sock.groupSettingUpdate(jid, 'not_announcement');
            return sock.sendMessage(jid, { text: "🔓 Unmuted" });
        }

        if (command === "!ginfo") {
            return sock.sendMessage(jid, {
                text: `📊 ${metadata.subject}\n👥 ${metadata.participants.length}`
            });
        }

        if (command === "!listonline") {
            const active = [...activityTracker.values()]
                .filter(t => Date.now() - t < 1800000).length;

            return sock.sendMessage(jid, {
                text: `🟢 Active users: ${active}`
            });
        }

        if (command === "!kick") {
            const target = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;

            await sock.groupParticipantsUpdate(jid, [target], "remove");
            return sock.sendMessage(jid, { text: "🚫 Kicked" });
        }

        if (command === "!promote") {
            const target = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            if (!target) return;

            await sock.groupParticipantsUpdate(jid, [target], "promote");
            return sock.sendMessage(jid, { text: "⬆️ Promoted" });
        }
    });
}

// ---------------- DASHBOARD ----------------
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
<title>JARVIS DASHBOARD</title>
<style>
body{background:#0f172a;color:white;text-align:center;font-family:Arial}
.box{background:#1e293b;width:350px;margin:80px auto;padding:20px;border-radius:12px}
input{width:90%;padding:10px;margin:10px;border-radius:8px}
button{width:95%;padding:10px;background:#2563eb;color:white;border:none;border-radius:8px}
.code{margin-top:15px;font-size:20px;color:#22c55e}
</style>
</head>
<body>

<div class="box">
<h2>🤖 JARVIS PAIRING</h2>

<input id="num" placeholder="234XXXXXXXXXX"/>
<button onclick="pair()">Generate Code</button>

<div class="code" id="code">---</div>
</div>

<script>
async function pair(){
const num=document.getElementById("num").value;
document.getElementById("code").innerText="Loading...";
const res=await fetch("/pair?number="+num);
document.getElementById("code").innerText=await res.text();
}
</script>

</body>
</html>
    `);
});

// ---------------- PAIRING ----------------
app.get('/pair', async (req, res) => {
    const number = req.query.number?.replace(/[^0-9]/g, '');

    if (!sock) return res.send("Bot not ready");
    if (!number) return res.send("Invalid number");

    try {
        const code = await sock.requestPairingCode(number);
        res.send(`✅ CODE: ${code}`);
    } catch (e) {
        res.send("❌ Failed");
    }
});

app.listen(port, () => startJARVIS());
