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
process.on('uncaughtException', (err) => {
    console.log('⚠️ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (err) => {
    console.log('⚠️ Unhandled Rejection:', err);
});

// ---------------- CONFIG ----------------
const OWNER_NUMBER = "2347051768946";
const BOT_NAME = "JARVIS AI";

// ---------------- DATABASE ----------------
mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.log("❌ MongoDB Error:", err));

const ConfigSchema = new mongoose.Schema({
    keyName: String,
    keyValue: String
});

const Config = mongoose.model("Config", ConfigSchema);

// ---------------- AI FUNCTION ----------------
async function askAI(prompt) {
    try {

        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return "❌ Gemini API key missing";
        }

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            {
                contents: [
                    {
                        parts: [
                            {
                                text: prompt
                            }
                        ]
                    }
                ]
            }
        );

        return response.data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";

    } catch (err) {

        console.log("AI ERROR:", err.response?.data || err.message);

        return "⚠️ AI failed";
    }
}

// ---------------- BOT ----------------
let sock;

// ---------------- START BOT ----------------
async function startJARVIS() {

    const { state, saveCreds } = await useMultiFileAuthState("./auth_info");

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        defaultQueryTimeoutMs: 60000
    });

    // ---------------- SAVE CREDS ----------------
    sock.ev.on("creds.update", saveCreds);

    // ---------------- CONNECTION ----------------
    sock.ev.on("connection.update", async (update) => {

        console.log(update);

        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            console.log(`✅ ${BOT_NAME} CONNECTED`);
        }

        if (connection === "close") {

            console.log("❌ Connection closed");

            const shouldReconnect =
                (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
                console.log("🔄 Reconnecting...");
                startJARVIS();
            }
        }
    });

    // ---------------- WELCOME + GOODBYE ----------------
    sock.ev.on("group-participants.update", async (anu) => {

        try {

            const metadata = await sock.groupMetadata(anu.id);

            for (const num of anu.participants) {

                const user = num.split("@")[0];

                // WELCOME
                if (anu.action === "add" || anu.action === "invite") {

                    await sock.sendMessage(anu.id, {
                        text:
`👋 Welcome @${user}

Welcome to *${metadata.subject}* 🚀

Please obey the group rules.`,
                        mentions: [num]
                    });
                }

                // GOODBYE
                if (anu.action === "remove") {

                    await sock.sendMessage(anu.id, {
                        text:
`👋 Goodbye @${user}

We wish you success 🎓`,
                        mentions: [num]
                    });
                }
            }

        } catch (err) {
            console.log("GROUP ERROR:", err.message);
        }
    });

    // ---------------- MESSAGE HANDLER ----------------
    sock.ev.on("messages.upsert", async ({ messages }) => {

        try {

            const m = messages[0];

            if (!m.message || m.key.fromMe) return;

            const jid = m.key.remoteJid;

            const sender = m.key.participant || jid;

            const body =
                m.message.conversation ||
                m.message.extendedTextMessage?.text ||
                m.message.imageMessage?.caption ||
                "";

            const text = body.trim();

            const command = text.split(" ")[0].toLowerCase();

            const args = text.split(" ").slice(1);

            // ---------------- OWNER ----------------
            const isOwner = sender.includes(OWNER_NUMBER);

            // ---------------- ADMIN CHECK ----------------
            let isStaff = isOwner;

            if (jid.endsWith("@g.us")) {

                try {

                    const metadata = await sock.groupMetadata(jid);

                    const admins = metadata.participants
                        .filter(p => p.admin)
                        .map(p => p.id);

                    isStaff = admins.includes(sender) || isOwner;

                } catch {}
            }

            // ---------------- AI COMMAND ----------------
            if (command === "!ai") {

                if (!isStaff) {
                    return sock.sendMessage(jid, {
                        text: "❌ Admin only command"
                    });
                }

                const prompt = args.join(" ");

                if (!prompt) {
                    return sock.sendMessage(jid, {
                        text: "Example:\n!ai what is a noun"
                    });
                }

                await sock.sendPresenceUpdate("composing", jid);

                const reply = await askAI(prompt);

                return sock.sendMessage(jid, {
                    text: `🤖 *JARVIS AI*\n\n${reply}`
                });
            }

            // ---------------- ADD MEMBER ----------------
            if (command === "!add") {

                if (!jid.endsWith("@g.us")) {
                    return sock.sendMessage(jid, {
                        text: "❌ Group only command"
                    });
                }

                if (!isStaff) {
                    return sock.sendMessage(jid, {
                        text: "❌ Admin only command"
                    });
                }

                try {

                    let target;

                    // NUMBER
                    if (args[0]) {

                        const cleanNumber = args[0].replace(/[^0-9]/g, '');

                        target = cleanNumber + "@s.whatsapp.net";
                    }

                    // MENTION
                    if (!target) {
                        target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    }

                    if (!target) {
                        return sock.sendMessage(jid, {
                            text: "Example:\n!add 2348012345678"
                        });
                    }

                    await sock.groupParticipantsUpdate(
                        jid,
                        [target],
                        "add"
                    );

                    return sock.sendMessage(jid, {
                        text: "✅ User added successfully"
                    });

                } catch (err) {

                    console.log(err);

                    return sock.sendMessage(jid, {
                        text: "❌ Failed to add user\n\nMake sure bot is admin."
                    });
                }
            }

        } catch (err) {
            console.log("MESSAGE ERROR:", err.message);
        }
    });
}

// ---------------- DASHBOARD ----------------
app.get("/", (req, res) => {

    res.send(`
<!DOCTYPE html>
<html>

<head>

<title>JARVIS AI DASHBOARD</title>

<meta name="viewport" content="width=device-width, initial-scale=1.0">

<style>

body{
background:#0f172a;
font-family:Arial;
color:white;
text-align:center;
padding:20px;
}

.container{
max-width:500px;
margin:auto;
}

.card{
background:#1e293b;
padding:20px;
margin-top:20px;
border-radius:10px;
}

input{
width:95%;
padding:12px;
border:none;
border-radius:5px;
margin-top:10px;
}

button{
width:100%;
padding:12px;
margin-top:10px;
background:#2563eb;
border:none;
color:white;
border-radius:5px;
font-size:16px;
cursor:pointer;
}

button:hover{
background:#1d4ed8;
}

#code{
margin-top:15px;
padding:10px;
border:1px dashed #38bdf8;
font-size:20px;
}

</style>

</head>

<body>

<h2>🤖 JARVIS AI PAIRING DASHBOARD</h2>

<div class="container">

<div class="card">

<h3>Generate Pairing Code</h3>

<input id="number" placeholder="2348012345678">

<button onclick="pair()">Generate Pairing Code</button>

<div id="code">---</div>

</div>

</div>

<script>

async function pair(){

const number = document.getElementById("number").value;

document.getElementById("code").innerText = "Generating...";

const res = await fetch("/pair?number=" + number);

const data = await res.text();

document.getElementById("code").innerText = data;

}

</script>

</body>
</html>
`);
});

// ---------------- PAIR ROUTE ----------------
app.get("/pair", async (req, res) => {

    try {

        const number = req.query.number?.replace(/[^0-9]/g, '');

        if (!number) {
            return res.send("❌ Enter phone number");
        }

        if (!sock) {
            return res.send("❌ Bot not ready");
        }

        const code = await sock.requestPairingCode(number.trim());

        return res.send(code);

    } catch (err) {

        console.log("PAIR ERROR:", err);

        return res.send("❌ Pairing failed");
    }
});

// ---------------- START SERVER ----------------
app.listen(port, async () => {

    console.log("🌐 Server running on port", port);

    await startJARVIS();
});
