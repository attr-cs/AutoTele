require("dotenv").config();
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const basicAuth = require("express-basic-auth");
const axios = require("axios");
const mongoose = require("mongoose");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const phoneNumber = process.env.PHONE_NUMBER;
const superSecretPassword = process.env.SUPER_SECRET_PASSWORD;

const sessionString = process.env.SESSION_STRING || "";
const session = new StringSession(sessionString);
const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });

let botRunning = false;
let replyMessage = "The person you are looking for, will be here soon...";
let userCache = {};
let llmEnabled = false;
let systemPrompt = "You're a chill dude. Keep it short, cool, and casual. No big texts, use emojis very rare. You have a black color dp, with no name, so people also think of u as a ghost. U use less words while speak, u r savage, silent, mature, dont use ..., you also talk in hindi if someone talks with you in hindi, you talk with the language people talk with you, otherwise you talk in english. ";
let chatHistoryMemory = {};
let selectedModel = "gemini-2.0-flash"; // Default model

 // Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "YOUR_API_KEY");

// MongoDB Setup
mongoose.connect(process.env.DB_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
    retryWrites: true,
    retryReads: true
})
.then(() => uiLog("INFO", "Connected to MongoDB"))
.catch(err => uiLog("ERROR", `MongoDB initial connection failed: ${err.message}`));

mongoose.connection.on("disconnected", () => uiLog("WARN", "MongoDB disconnected, attempting to reconnect..."));
mongoose.connection.on("reconnected", () => uiLog("INFO", "MongoDB reconnected"));

const messageSchema = new mongoose.Schema({
    userId: String,
    role: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model("Message", messageSchema);
app.get('/test', (req, res) => {
    res.json({"msg":"service is live.."});
});
// Authentication
app.use(basicAuth({
    users: { "admin": superSecretPassword },
    challenge: true,
    unauthorizedResponse: "Unauthorized: Please log in."
}));
app.get('/', (req, res) => {
    res.sendFile('userbotserverindex.html', { root: 'public' });
});

app.use(express.static("public"));

function uiLog(type, message, userInfo = null) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${type}: ${message}`;
    console.log(logEntry);
    io.emit("log", { type, message, timestamp, userInfo });
}

async function getUserInfo(userId) {
    if (userCache[userId]) return userCache[userId];
    try {
        const user = await client.getEntity(new Api.PeerUser({ userId }));
        const info = {
            id: user.id.valueOf(),
            firstName: user.firstName || "",
            lastName: user.lastName || "",
            username: user.username || "",
            displayName: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Unknown"
        };
        if (info.username) info.displayName += ` (${info.username})`;
        userCache[userId] = info;
        return info;
    } catch (error) {
        uiLog("ERROR", `Failed to fetch user info for ${userId}: ${error.message}`);
        return { id: userId, displayName: `User ${userId}`, username: "" };
    }
}

async function fetchMessages(userId, offsetId = 0, limit = 20) {
    try {
        const messages = await client.getMessages(new Api.PeerUser({ userId }), { limit, offsetId });
        return messages.map(msg => ({
            id: msg.id,
            text: msg.message,
            date: new Date(msg.date * 1000).toLocaleString(),
            out: msg.out
        }));
    } catch (error) {
        uiLog("ERROR", `Failed to fetch messages for ${userId}: ${error.message}`);
        return [];
    }
}

async function updateChatHistory(userId, role, content) {
    try {
        await Message.create({ userId, role, content });
        const count = await Message.countDocuments({ userId });
        if (count > 5) {
            const oldest = await Message.findOne({ userId }).sort({ timestamp: 1 });
            await Message.deleteOne({ _id: oldest._id });
        }
    } catch (error) {
        uiLog("ERROR", `Failed to save to MongoDB: ${error.message}, using in-memory fallback`);
        if (!chatHistoryMemory[userId]) chatHistoryMemory[userId] = [];
        chatHistoryMemory[userId].push({ role, content });
        if (chatHistoryMemory[userId].length > 5) chatHistoryMemory[userId].shift();
    }
}

async function getChatHistory(userId) {
    try {
        const dbHistory = await Message.find({ userId }).sort({ timestamp: 1 }).lean();
        if (dbHistory.length > 0) return dbHistory;
        return chatHistoryMemory[userId] || [];
    } catch (error) {
        uiLog("ERROR", `Failed to fetch from MongoDB: ${error.message}, using in-memory fallback`);
        return chatHistoryMemory[userId] || [];
    }
}

async function callLLM(userId, prompt) {
    const history = await getChatHistory(userId);
    const messages = [
        { role: "system", content: systemPrompt },
        ...history.map(msg => ({content: msg.content })),
        { role: "user", content: prompt }
    ];

    let apiConfig;
    if (selectedModel.includes("gemini")) {
        // Gemini via Google Generative AI SDK
        try {
            uiLog("INFO", `Calling Gemini (${selectedModel}): ${prompt.substring(0, 50)}...`);
            const model = genAI.getGenerativeModel({ model: selectedModel });
            const fullPrompt = messages.map(m => `${m.content}`).join("\n");
            const result = await model.generateContent(fullPrompt);
            const reply = result.response.text().trim();
            return reply || "No response";
        } catch (error) {
            uiLog("ERROR", `Gemini (${selectedModel}) failed: ${error.message}`);
            return "Jyada ho gaya, now wait.";
        }
    } else if (selectedModel.includes("huggingface/")) {
        // Hugging Face direct API
        apiConfig = {
            url: "https://api-inference.huggingface.co/models/" + selectedModel.replace("huggingface/", ""),
            headers: { "Authorization": `Bearer ${process.env.HUGGINGFACE_API_KEY}`, "Content-Type": "application/json" },
            body: { inputs: prompt }
        };
    } else if (selectedModel.includes("together/")) {
        // Together AI direct API
        apiConfig = {
            url: "https://api.together.xyz/v1/chat/completions",
            headers: { "Authorization": `Bearer ${process.env.TOGETHER_API_KEY}`, "Content-Type": "application/json" },
            body: { model: selectedModel.replace("together/", ""), messages, max_tokens: 50, temperature: 0.7 }
        };
    } else if (selectedModel.includes("deepinfra/")) {
        // DeepInfra direct API
        apiConfig = {
            url: "https://api.deepinfra.com/v1/openai-compatible/chat/completions",
            headers: { "Authorization": `Bearer ${process.env.DEEPINFRA_API_KEY}`, "Content-Type": "application/json" },
            body: { model: selectedModel.replace("deepinfra/", ""), messages, max_tokens: 50, temperature: 0.7 }
        };
    } else {
        // OpenRouter (default, covers most models)
        apiConfig = {
            url: "https://openrouter.ai/api/v1/chat/completions",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": "http://localhost:4000",
                "X-Title": "Telegram Userbot",
                "Content-Type": "application/json"
            },
            body: { model: selectedModel, messages, max_tokens: 50, temperature: 0.7 }
        };
    }

    // Handle non-Gemini APIs
    if (!selectedModel.includes("gemini")) {
        try {
            uiLog("INFO", `Calling ${selectedModel}: ${prompt.substring(0, 50)}...`);
            const response = await axios.post(apiConfig.url, apiConfig.body, { headers: apiConfig.headers, timeout: 5000 });
            const reply = selectedModel.includes("huggingface/") ? response.data.generated_text?.trim() : response.data.choices[0].message.content.trim();
            return reply || "No response";
        } catch (error) {
            uiLog("ERROR", `${selectedModel} failed: ${error.message}`);
            return "Error";
        }
    }
}

function getFallbackReply(prompt) {
    const replies = {
        "hello": "hey",
        "hi": "sup",
        "hii": "yo",
        "hey": "hm",
        "good": "k",
        "how are you": "good",
        "what's up": "nm",
        "bye": "bye",
        "ok": "k",
        "thank you": "np",
        "thanks": "k",
        "nice": "ye",
        "great": "mhm",
        "awesome": "ye",
        "cool": "ik",
        "morning": "morn",
        "night": "gn",
        "goodnight": "gn"
    };
    const cleanPrompt = prompt.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();
    return replies[cleanPrompt] || "hm";
}

async function startBot() {
    if (botRunning) return uiLog("INFO", "Bot is already running!");
    botRunning = true;

    uiLog("INFO", "Starting Userbot...");
    await client.start({
        phoneNumber: async () => phoneNumber,
        password: async () => "",
        phoneCode: async () => {
            uiLog("INFO", "Enter the code you received on Telegram (check console):");
            return new Promise((resolve) => process.stdin.once("data", (data) => resolve(data.toString().trim())));
        },
        onError: (err) => uiLog("ERROR", `Login Error: ${err.message}`),
    });

    uiLog("INFO", "Userbot is running...");
    const newSession = client.session.save();
    uiLog("INFO", `SESSION STRING (Save this in .env for auto-login): ${newSession}`);
    fs.writeFileSync("session.txt", newSession);

    const me = await client.getMe();
    uiLog("INFO", `Logged in as: ${me.username || me.phone}`);

    client.addEventHandler((update) => onMessage(update, me));
    uiLog("INFO", "Listening for incoming messages...");
}

async function stopBot() {
    if (!botRunning) return uiLog("INFO", "Bot is already stopped!");
    botRunning = false;
    await client.disconnect();
    uiLog("INFO", "Bot stopped.");
}

async function onMessage(update, me) {
    if (!botRunning) return;

    try {
        const myId = me.id.valueOf();

        if (update instanceof Api.UpdateNewMessage || update instanceof Api.UpdateShortMessage) {
            const isShort = update instanceof Api.UpdateShortMessage;
            const senderId = isShort ? update.userId.valueOf() : update.message.peerId?.userId?.valueOf();
            const messageText = isShort ? update.message : update.message.message;
            const isDM = isShort || update.message.peerId instanceof Api.PeerUser;
            const out = isShort ? update.out : update.message.out;

            const userInfo = await getUserInfo(senderId);
            if (isDM && !out && senderId !== myId) {
                uiLog("MESSAGE", `${userInfo.displayName} sent: "${messageText}"`, userInfo);
                io.emit("newMessage", { userId: senderId, text: messageText, date: new Date().toLocaleString(), out: false });
                await updateChatHistory(senderId, "user", messageText);
                const reply = llmEnabled ? await callLLM(senderId, messageText) : replyMessage;
                uiLog("INFO", `Replying to ${userInfo.displayName} with: "${reply}"`);
                await client.sendMessage(senderId, { message: reply });
                await updateChatHistory(senderId, "bot", reply);
            } else if (out && senderId !== myId) { // Only log outgoing messages, don't reply
                uiLog("INFO", `Sent to ${userInfo.displayName}: "${messageText}"`);
                io.emit("newMessage", { userId: senderId, text: messageText, date: new Date().toLocaleString(), out: true });
            }
        } else if (update instanceof Api.UpdateUserTyping) {
            const userId = update.userId.valueOf();
            if (userId !== myId) {
                const userInfo = await getUserInfo(userId);
                uiLog("TYPING", `${userInfo.displayName} is typing...`, userInfo);
            }
        }
    } catch (error) {
        uiLog("ERROR", `Error in message handler: ${error.message}`);
    }
}
io.on("connection", (socket) => {
    uiLog("INFO", "UI connected!");
    socket.on("startBot", () => startBot());
    socket.on("stopBot", () => stopBot());
    socket.on("setReply", (newReply) => {
        replyMessage = newReply;
        uiLog("INFO", `Reply message updated to: "${replyMessage}"`);
    });
    socket.on("fetchMessages", async ({ userId, offsetId }) => {
        const messages = await fetchMessages(userId, offsetId);
        socket.emit("messages", { userId, messages });
    });
    socket.on("sendMessage", async ({ userId, text }) => {
        await client.sendMessage(userId, { message: text });
        uiLog("INFO", `Sent to ${userCache[userId]?.displayName || userId}: "${text}"`);
        io.emit("newMessage", { userId, text, date: new Date().toLocaleString(), out: true });
        await updateChatHistory(userId, "bot", text);
    });
    socket.on("toggleLLM", (enabled) => {
        llmEnabled = enabled;
        uiLog("INFO", `LLM communication ${enabled ? "enabled" : "disabled"}`);
    });
    socket.on("setSystemPrompt", (prompt) => {
        systemPrompt = prompt;
        uiLog("INFO", `LLM system prompt set to: "${prompt}"`);
    });
    socket.on("setModel", (model) => {
        selectedModel = model;
        uiLog("INFO", `Selected LLM model set to: "${model}"`);
    });
});

server.listen(process.env.PORT || 4000, () => {
    uiLog("INFO", `Web UI running at http://localhost:${process.env.PORT || 4000}`);
    startBot();
});
