// api/gemini.js — Yeh Vercel Serverless Function hai (Bilkul Safe)
export default async function handler(req, res) {
    // CORS headers taaki frontend connect kar sake
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 10 keys ko environment variables se load karna
    const GEMINI_KEYS = [
        process.env.GEMINI_KEY_1, process.env.GEMINI_KEY_2, process.env.GEMINI_KEY_3,
        process.env.GEMINI_KEY_4, process.env.GEMINI_KEY_5, process.env.GEMINI_KEY_6,
        process.env.GEMINI_KEY_7, process.env.GEMINI_KEY_8, process.env.GEMINI_KEY_9,
        process.env.GEMINI_KEY_10
    ].filter(k => k && k.trim().length > 0 && !k.startsWith('xxxx'));

    if (GEMINI_KEYS.length === 0) {
        return res.status(500).json({ error: "Backend par koi API Key configured nahi hai." });
    }

    const { messages, model, temperature, isImage, prompt } = req.body;
    const selectedModel = model || "gemini-2.5-flash";
    const temp = temperature !== undefined ? parseFloat(temperature) : 0.7;

    // Auto-Rotation aur Request send karne ka loop
    for (let i = 0; i < GEMINI_KEYS.length; i++) {
        const currentKey = GEMINI_KEYS[i];
        
        // Check karna ki text generate karna hai ya image
        let endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${currentKey}`;
        let bodyPayload = {};

        if (isImage) {
            endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent?key=${currentKey}`;
            bodyPayload = {
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
            };
        } else {
            bodyPayload = {
                contents: messages,
                generationConfig: { temperature: temp, maxOutputTokens: 2048 },
                systemInstruction: { parts: [{ text: "You are SoftArmory, a helpful and intelligent AI assistant. Be concise, clear, and friendly." }] }
            };
        }

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
            });

            if (response.status === 429 || response.status === 401 || response.status === 403 || response.status === 503) {
                console.warn(`Key ${i + 1} par error aaya (Status ${response.status}), agli key try kar rahe hain...`);
                continue; // Agar limit khatam ya key kharab, toh agli key par jao
            }

            if (!response.ok) {
                throw new Error(`HTTP Error ${response.status}`);
            }

            const data = await response.json();
            return res.status(200).json(data); // Sahi response milte hi frontend ko bhej do

        } catch (err) {
            console.error(`Key ${i + 1} fail ho gayi:`, err.message);
            if (i === GEMINI_KEYS.length - 1) {
                return res.status(500).json({ error: "Saari API keys check kar li, sabhi par limit ya error hai." });
            }
        }
    }
}