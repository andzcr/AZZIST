require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Configure CORS as needed for production
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- CONFIGURATION ---
// Ensure you have a .env file with GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, and TELEGRAM_CHAT_ID
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
let activeModelName = "gemini-pro"; 

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// --- MODEL DETECTION ---
// Automatically finds the best available Gemini model
async function detectBestModel() {
    try {
        console.log("📡 Searching for the best available Gemini model...");
        const listResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await listResponse.json();
        
        const viableModels = data.models.filter(m => m.supportedGenerationMethods.includes("generateContent"));
        
        const bestModel = viableModels.find(m => m.name.includes("flash")) || 
                        viableModels.find(m => m.name.includes("pro")) || 
                        viableModels[0];

        if (bestModel) {
            activeModelName = bestModel.name.replace("models/", "");
            console.log(`✅ Model detected and activated: ${activeModelName}`);
        } else {
            console.warn("⚠️ Could not auto-detect model. Fallback: gemini-pro");
        }
    } catch (error) {
        console.error("⚠️ Model auto-detection error (using default):", error.message);
    }
}

detectBestModel();

// --- LOAD CONTEXT ---
// Load the personality/context file for the bot
let contextData = "";
try {
    // Make sure to create 'context.txt' inside 'public/data/'
    const contextPath = path.join(__dirname, 'public', 'data', 'context.txt');
    contextData = fs.readFileSync(contextPath, 'utf8');
} catch (err) {
    console.error("⚠️ Error: context.txt not found in public/data/");
    contextData = "You are a helpful assistant."; // Fallback context
}

// --- TELEGRAM NOTIFICATIONS ---
app.post('/api/notify', async (req, res) => {
    const { type, data } = req.body;

    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
        console.error("❌ Telegram Token or Chat ID missing in .env");
        return res.status(500).json({ error: "Server config error" });
    }

    let telegramMessage = "";

    switch (type) {
        case 'CHAT_OPEN':
            telegramMessage = `🔵 <b>Chat Opened!</b>\n\n🕒 Time: ${new Date().toLocaleString()}`;
            break;
        
        case 'NEW_REVIEW':
            telegramMessage = `⭐ <b>NEW REVIEW!</b>\n\n` +
                              `👤 <b>Name:</b> ${data.name}\n` +
                              `🌟 <b>Rating:</b> ${data.rating}/5\n` +
                              `📝 <b>Message:</b> ${data.description}\n` +
                              `💼 <b>Service:</b> ${data.service}`;
            break;

        case 'NEW_CONTACT':
            telegramMessage = `📬 <b>NEW LEAD (Contact Form)</b>\n\n` +
                              `📧 <b>Email:</b> ${data.email}\n` +
                              `📱 <b>Phone:</b> ${data.phone}\n` +
                              `🏷️ <b>Category:</b> ${data.category}\n` +
                              `💬 <b>Message:</b> ${data.message}`;
            break;

        default:
            telegramMessage = `⚠️ <b>Generic Notification:</b>\n${JSON.stringify(data)}`;
    }

    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: telegramMessage,
                parse_mode: 'HTML' 
            })
        });
        res.json({ success: true });
    } catch (error) {
        console.error("❌ Telegram send error:", error);
        res.status(500).json({ error: "Failed to send notification" });
    }
});

// --- CHAT ENDPOINT ---
app.post('/api/chat', async (req, res) => {
    const userMessage = req.body.message;

    if (!userMessage) {
        return res.status(400).json({ reply: "Please write a message." });
    }

    const fullPrompt = `
    ${contextData}
    
    CURRENT TASK:
    Reply to the user based on the info above.
    Be concise and respect the style.
    
    USER: ${userMessage}
    ASSISTANT:
    `;

    try {
        const model = genAI.getGenerativeModel({ model: activeModelName });
        
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        let text = response.text();
        
        // Remove markdown bolding for cleaner UI if desired
        text = text.replace(/\*\*/g, '').trim();
        
        res.json({ reply: text });

    } catch (error) {
        console.error(`❌ Error using model ${activeModelName}:`, error);
        
        // Fallback logic for Gemini 1.5 Flash if main model fails
        if (activeModelName !== 'gemini-1.5-flash') {
            try {
                console.log("🔄 Attempting recovery with gemini-1.5-flash...");
                const backupModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
                const backupResult = await backupModel.generateContent(fullPrompt);
                const backupText = await backupResult.response.text();
                return res.json({ reply: backupText.replace(/\*\*/g, '').trim() });
            } catch (backupError) {
                console.error("❌ Backup failed as well.");
            }
        }

        res.status(500).json({ reply: "Sorry, I'm having trouble connecting to the AI right now. Please try again later." });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});
