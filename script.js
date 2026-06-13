// ══════════════════════════════════════════════════════════════
//  SOFTARMORY — GEMINI API ENGINE (Secure Vercel Architecture)
// ══════════════════════════════════════════════════════════════

const GEMINI_MODEL = "gemini-2.5-flash";
// Ab hum Google ko direct call nahi karenge, apni hi website ke /api/gemini par bhejenge
const SECURE_API_ENDPOINT = "/api/gemini";

let currentChatId = null;
let conversationHistory = [];

// ══════════════════════════════════════════════════════════════
//  SECURE API CALLS (Text & Image via Vercel Serverless)
// ══════════════════════════════════════════════════════════════
async function callGemini(userText, signal) {
    const model = dom.modelSelect?.value || GEMINI_MODEL;
    const temp  = parseFloat(dom.tempSlider?.value ?? 0.7);

    const messages = [
        ...conversationHistory,
        { role: "user", parts: [{ text: userText }] }
    ];

    try {
        const response = await fetch(SECURE_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
                messages: messages,
                model: model,
                temperature: temp,
                isImage: false
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData?.error || `HTTP Error ${response.status}`);
        }

        const data = await response.json();
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!reply) {
            throw new Error("Empty response received. Try again.");
        }

        conversationHistory.push({ role: "user",  parts: [{ text: userText }] });
        conversationHistory.push({ role: "model", parts: [{ text: reply }] });

        if (conversationHistory.length > 40) {
            conversationHistory.splice(0, 2);
        }

        return { reply };

    } catch (err) {
        if (err.name === 'AbortError') return { aborted: true };
        if (err.message?.toLowerCase().includes('failed to fetch')) {
            return { error: "Network error — check connection or local server." };
        }
        return { error: err.message || String(err) };
    }
}

async function generateImage(prompt, signal) {
    try {
        const response = await fetch(SECURE_API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
                prompt: prompt,
                isImage: true
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData?.error || `HTTP Error ${response.status}`);
        }

        const data = await response.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];

        let imageData = null;
        let textNote = '';
        for (const part of parts) {
            if (part.inlineData?.data) {
                imageData = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
            } else if (part.text) {
                textNote += part.text;
            }
        }

        if (!imageData) {
            throw new Error("No image returned. Try a different prompt.");
        }

        return { image: imageData, note: textNote };

    } catch (err) {
        if (err.name === 'AbortError') return { aborted: true };
        if (err.message?.toLowerCase().includes('failed to fetch')) {
            return { error: "Network error — check connection." };
        }
        return { error: err.message || String(err) };
    }
}

// ══════════════════════════════════════════════════════════════
//  DOM CACHE (single query pass for perf)
// ══════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);

const dom = {
    messagesContainer: $('messagesInner'),
    messages: $('messages'),
    messageInput: $('messageInput'),
    sendBtn: $('sendBtn'),
    sendIcon: $('sendIcon'),
    stopIcon: $('stopIcon'),
    sidebar: $('sidebar'),
    mobileMenuBtn: $('mobileMenu'),
    overlay: $('overlay'),
    welcome: $('welcome'),
    history: $('history'),
    newChatBtn: $('newChatBtn'),
    clearBtn: $('clearBtn'),
    exportBtn: $('exportBtn'),
    searchInput: $('searchInput'),
    modelSelect: $('modelSelect'),
    tempSlider: $('tempSlider'),
    tempVal: $('tempVal'),
    particleToggle: $('particleToggle'),
    soundToggle: $('soundToggle'),
    voiceToggle: $('voiceToggle'),
    statusDot: $('statusDot'),
    footerStats: $('footerStats'),
    attachBtn: $('attachBtn'),
    fileInput: $('fileInput'),
    micBtn: $('micBtn'),
    imageBtn: $('imageBtn'),
    inputWrapper: $('inputWrapper'),
    dropOverlay: $('dropOverlay'),
    toastContainer: $('toastContainer'),
    customSystemInstruction: $('customSystemInstruction'),
    sysInstructToggleLabel: $('sysInstructToggleLabel'),
    canvas: $('particles'),
};

// ══════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════
let isGenerating = false;
let abortController = null;
let currentChatId = null;
let chats = {}; // {id: {title, messages: [{role, content}], history: [gemini format]}}

const SETTINGS_KEY = 'softarmory_settings';
const CHATS_KEY = 'softarmory_chats';

// ══════════════════════════════════════════════════════════════
//  FEATURE 14: SETTINGS PERSISTENCE
// ══════════════════════════════════════════════════════════════
function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s.model) dom.modelSelect.value = s.model;
        if (s.temp !== undefined) {
            dom.tempSlider.value = s.temp;
            dom.tempVal.textContent = s.temp;
        }
        if (s.particles === false) dom.particleToggle.classList.remove('active');
        if (s.sound === false) dom.soundToggle.classList.remove('active');
        if (s.voice === true) dom.voiceToggle.classList.add('active');
        if (s.customInstruction) dom.customSystemInstruction.value = s.customInstruction;
    } catch (e) { /* ignore */ }
}

function saveSettings() {
    const s = {
        model: dom.modelSelect.value,
        temp: dom.tempSlider.value,
        particles: dom.particleToggle.classList.contains('active'),
        sound: dom.soundToggle.classList.contains('active'),
        voice: dom.voiceToggle.classList.contains('active'),
        customInstruction: dom.customSystemInstruction.value
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

// ══════════════════════════════════════════════════════════════
//  FEATURE 1: CHAT HISTORY (localStorage)
// ══════════════════════════════════════════════════════════════
function loadChats() {
    try {
        const raw = localStorage.getItem(CHATS_KEY);
        chats = raw ? JSON.parse(raw) : {};
    } catch (e) { chats = {}; }
}

function saveChats() {
    try {
        localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
    } catch (e) { /* storage full etc */ }
}

function renderHistory() {
    const ids = Object.keys(chats).sort((a, b) => (chats[b].updatedAt || 0) - (chats[a].updatedAt || 0));
    if (ids.length === 0) {
        dom.history.innerHTML = '<div class="history-empty">No saved chats yet</div>';
        return;
    }
    const frag = document.createDocumentFragment();
    ids.forEach(id => {
        const chat = chats[id];
        const item = document.createElement('div');
        item.className = 'history-item' + (id === currentChatId ? ' active' : '');
        item.dataset.id = id;

        const title = document.createElement('span');
        title.className = 'history-item-title';
        title.textContent = chat.title || 'New Chat';

        const del = document.createElement('span');
        del.className = 'history-delete';
        del.textContent = '🗑';
        del.title = 'Delete chat';

        item.appendChild(title);
        item.appendChild(del);
        frag.appendChild(item);
    });
    dom.history.innerHTML = '';
    dom.history.appendChild(frag);
}

dom.history.addEventListener('click', (e) => {
    const delBtn = e.target.closest('.history-delete');
    const item = e.target.closest('.history-item');
    if (!item) return;
    const id = item.dataset.id;

    if (delBtn) {
        delete chats[id];
        saveChats();
        if (id === currentChatId) {
            startNewChat(false);
        } else {
            renderHistory();
        }
        showToast('Chat deleted', 'success');
        return;
    }

    loadChat(id);
});

function loadChat(id) {
    const chat = chats[id];
    if (!chat) return;
    currentChatId = id;
    conversationHistory = JSON.parse(JSON.stringify(chat.history || []));

    dom.messagesContainer.innerHTML = '';
    dom.welcome.style.display = 'none';

    chat.messages.forEach(m => {
        if (m.role === 'user') {
            appendMessage(escHtml(m.content), 'user');
        } else if (typeof m.content === 'string' && m.content.startsWith('[Generated image for:')) {
            appendMessage(`<em style="color:var(--text-dim)">🖼️ ${escHtml(m.content)} — image not stored in history, regenerate to view again.</em>`, 'assistant', null, false);
        } else {
            appendMessage(renderMarkdown(m.content), 'assistant', m.meta || null, false);
        }
    });

    renderHistory();
    scrollToBottom(true);
}

function startNewChat(resetUI = true) {
    currentChatId = null;
    conversationHistory = [];
    if (resetUI) {
        dom.messagesContainer.innerHTML = '';
        dom.welcome.style.display = 'flex';
        dom.messageInput.value = '';
        autoResizeInput();
        updateSendState();
    }
    renderHistory();
}

function ensureChatRecord(firstUserMsg) {
    if (currentChatId && chats[currentChatId]) return chats[currentChatId];
    currentChatId = 'chat_' + Date.now();
    chats[currentChatId] = {
        title: (firstUserMsg || 'New Chat').slice(0, 40),
        messages: [],
        history: [],
        updatedAt: Date.now()
    };
    return chats[currentChatId];
}

function persistMessage(role, content, meta) {
    const chat = ensureChatRecord(role === 'user' ? content : null);
    chat.messages.push(meta ? { role, content, meta } : { role, content });
    chat.history = conversationHistory;
    chat.updatedAt = Date.now();
    saveChats();
    renderHistory();
}

// ══════════════════════════════════════════════════════════════
//  FEATURE 15: TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════════
function showToast(message, type = '') {
    const toast = document.createElement('div');
    toast.className = 'toast' + (type ? ' ' + type : '');
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 2900);
}

// ══════════════════════════════════════════════════════════════
//  FEATURE 8: SOUND EFFECTS (WebAudio - tiny sci-fi blips)
// ══════════════════════════════════════════════════════════════
let audioCtx = null;
function playBlip(freq = 880, duration = 0.07, type = 'sine', vol = 0.05) {
    if (!dom.soundToggle.classList.contains('active')) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.value = vol;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        osc.stop(audioCtx.currentTime + duration);
    } catch (e) { /* ignore */ }
}

const SND = {
    send: () => playBlip(1100, 0.06, 'sine', 0.045),
    receive: () => playBlip(660, 0.09, 'sine', 0.04),
    toggle: () => playBlip(420, 0.05, 'triangle', 0.04),
    error: () => playBlip(220, 0.18, 'sawtooth', 0.05),
};

// ══════════════════════════════════════════════════════════════
//  FEATURE 9: TEXT-TO-SPEECH
// ══════════════════════════════════════════════════════════════
function speakText(text) {
    if (!dom.voiceToggle.classList.contains('active')) return;
    if (!('speechSynthesis' in window)) return;
    try {
        const clean = text.replace(/[#*`_>\-]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!clean) return;
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(clean);
        utter.rate = 1;
        utter.pitch = 1;
        window.speechSynthesis.speak(utter);
    } catch (e) { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════
//  FEATURE 10: SPEECH-TO-TEXT (DICTATION)
// ══════════════════════════════════════════════════════════════
let recognition = null;
let isRecording = false;

function setupSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
        dom.micBtn.title = 'Voice input not supported';
        return;
    }
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        isRecording = true;
        dom.micBtn.classList.add('recording');
    };

    recognition.onend = () => {
        isRecording = false;
        dom.micBtn.classList.remove('recording');
    };

    recognition.onerror = () => {
        isRecording = false;
        dom.micBtn.classList.remove('recording');
        showToast('Voice input error', 'error');
    };

    recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        dom.messageInput.value += (dom.messageInput.value ? ' ' : '') + transcript;
        autoResizeInput();
        updateSendState();
    };
}

dom.micBtn.addEventListener('click', () => {
    if (!recognition) {
        showToast('Voice input not supported in this browser', 'error');
        return;
    }
    if (isRecording) {
        recognition.stop();
    } else {
        try {
            recognition.start();
            SND.toggle();
        } catch (e) { /* already started */ }
    }
});

// ══════════════════════════════════════════════════════════════
//  FEATURE 11 & 5: TOKEN ESTIMATOR + WORD/CHAR COUNTER
// ══════════════════════════════════════════════════════════════
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
}

function updateFooterStats() {
    const text = dom.messageInput.value;
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const tokens = estimateTokens(text);
    if (chars === 0) {
        dom.footerStats.textContent = 'SoftArmory v5 • 48h memory';
    } else {
        dom.footerStats.textContent = `${words} words • ${chars} chars • ~${tokens} tokens`;
    }
}

// ══════════════════════════════════════════════════════════════
//  FEATURE 12: AUTO-RESIZE TEXTAREA
// ══════════════════════════════════════════════════════════════
function autoResizeInput() {
    dom.messageInput.style.height = 'auto';
    const newHeight = Math.min(dom.messageInput.scrollHeight, 150);
    dom.messageInput.style.height = newHeight + 'px';
}

function updateSendState() {
    if (isGenerating) return;
    if (dom.messageInput.value.trim() !== '') {
        dom.sendBtn.removeAttribute('disabled');
    } else {
        dom.sendBtn.setAttribute('disabled', 'true');
    }
}

dom.messageInput.addEventListener('input', () => {
    autoResizeInput();
    updateSendState();
    updateFooterStats();
});

// ══════════════════════════════════════════════════════════════
//  FEATURE 19: KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
    // Ctrl+K -> new chat
    if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        startNewChat();
        showToast('New chat started', 'success');
        return;
    }
    // / -> focus search (only if not already typing in an input/textarea)
    if (e.key === '/' && document.activeElement !== dom.messageInput &&
        document.activeElement !== dom.searchInput &&
        document.activeElement.tagName !== 'TEXTAREA' &&
        document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        dom.searchInput.focus();
        return;
    }
    // Esc -> close mobile sidebar
    if (e.key === 'Escape') {
        if (dom.sidebar.classList.contains('open')) {
            dom.sidebar.classList.remove('open');
            dom.overlay.classList.remove('show');
        }
        if (document.activeElement === dom.searchInput) {
            dom.searchInput.value = '';
            filterMessages('');
            dom.searchInput.blur();
        }
    }
});

// Shift+Enter newline / Enter send handled in messageInput keydown below

// ══════════════════════════════════════════════════════════════
//  FEATURE 6: CHAT SEARCH FILTERING
// ══════════════════════════════════════════════════════════════
function filterMessages(query) {
    const q = query.trim().toLowerCase();
    const msgs = dom.messagesContainer.querySelectorAll('.message');
    msgs.forEach(msg => {
        if (!q) {
            msg.classList.remove('hidden-by-search');
            return;
        }
        const text = msg.textContent.toLowerCase();
        if (text.includes(q)) {
            msg.classList.remove('hidden-by-search');
        } else {
            msg.classList.add('hidden-by-search');
        }
    });
}

let searchDebounce;
dom.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const val = e.target.value;
    searchDebounce = setTimeout(() => filterMessages(val), 120);
});

// ══════════════════════════════════════════════════════════════
//  FEATURE 17: STATUS DOT SYNC
// ══════════════════════════════════════════════════════════════
function setStatus(state) {
    dom.statusDot.classList.remove('thinking', 'offline');
    if (state === 'thinking') dom.statusDot.classList.add('thinking');
    else if (state === 'offline') dom.statusDot.classList.add('offline');
}

window.addEventListener('online', () => setStatus('idle'));
window.addEventListener('offline', () => setStatus('offline'));

// ══════════════════════════════════════════════════════════════
//  GEMINI API CALL with auto-rotation + abort support
// ══════════════════════════════════════════════════════════════
async function callGemini(userText, signal) {
    if (GEMINI_KEYS.length === 0) {
        return { error: "No Gemini API keys configured." };
    }

    const model = dom.modelSelect?.value || GEMINI_MODEL;
    const temp  = parseFloat(dom.tempSlider?.value ?? 0.7);

    let systemText = "You are SoftArmory, a helpful and intelligent AI assistant. Be concise, clear, and friendly.";
    const customInstr = dom.customSystemInstruction?.value?.trim();
    if (customInstr) {
        systemText += "\n\nAdditional instructions from the user: " + customInstr;
    }

    const contents = [
        ...conversationHistory,
        { role: "user", parts: [{ text: userText }] }
    ];

    for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
        if (exhaustedKeys.has(currentKeyIndex)) {
            if (!rotateToNextKey()) {
                return { error: "All Gemini API keys have reached their quota limit.", allExhausted: true };
            }
        }

        const key = GEMINI_KEYS[currentKeyIndex];
        try {
            const response = await fetch(GEMINI_ENDPOINT(key, model), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal,
                body: JSON.stringify({
                    contents,
                    generationConfig: {
                        temperature:     temp,
                        maxOutputTokens: 2048
                    },
                    systemInstruction: {
                        parts: [{ text: systemText }]
                    }
                })
            });

            if (response.status === 429 || response.status === 503) {
                console.warn(`[SoftArmory] Key ${currentKeyIndex + 1} quota hit (HTTP ${response.status}), rotating...`);
                if (!rotateToNextKey()) {
                    return { error: "All Gemini API keys have reached their quota limit.", allExhausted: true };
                }
                continue;
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const msg = errData?.error?.message || `HTTP ${response.status}`;

                if (msg.includes('RESOURCE_EXHAUSTED') || msg.toLowerCase().includes('quota')) {
                    console.warn(`[SoftArmory] Key ${currentKeyIndex + 1} resource exhausted, rotating...`);
                    if (!rotateToNextKey()) {
                        return { error: "All Gemini API keys have reached their quota limit.", allExhausted: true };
                    }
                    continue;
                }

                if (response.status === 400 || response.status === 401 || response.status === 403) {
                    console.warn(`[SoftArmory] Key ${currentKeyIndex + 1} auth/invalid (HTTP ${response.status}): ${msg}. Rotating...`);
                    if (!rotateToNextKey()) {
                        return { error: "All Gemini API keys have reached their quota limit.", allExhausted: true };
                    }
                    continue;
                }

                throw new Error(msg);
            }

            const data  = await response.json();
            const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!reply) {
                throw new Error("Empty response from Gemini. Try rephrasing.");
            }

            conversationHistory.push({ role: "user",  parts: [{ text: userText }] });
            conversationHistory.push({ role: "model", parts: [{ text: reply }] });

            if (conversationHistory.length > 40) {
                conversationHistory.splice(0, 2);
            }

            return { reply };

        } catch (err) {
            if (err.name === 'AbortError') {
                return { aborted: true };
            }
            if (err.message?.toLowerCase().includes('failed to fetch')) {
                return { error: "Network error — check your internet connection.", network: true };
            }
            throw err;
        }
    }

    return { error: "All Gemini API keys have reached their quota limit.", allExhausted: true };
}

// ══════════════════════════════════════════════════════════════
//  IMAGE GENERATION (Gemini image-preview model)
// ══════════════════════════════════════════════════════════════
const IMAGE_MODEL = "gemini-2.5-flash-image-preview";

async function generateImage(prompt, signal) {
    if (GEMINI_KEYS.length === 0) {
        return { error: "No Gemini API keys configured." };
    }

    for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
        if (exhaustedKeys.has(currentKeyIndex)) {
            if (!rotateToNextKey()) {
                return { error: "All Gemini API keys have reached their quota limit.", allExhausted: true };
            }
        }

        const key = GEMINI_KEYS[currentKeyIndex];
        try {
            const response = await fetch(GEMINI_ENDPOINT(key, IMAGE_MODEL), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal,
                body: JSON.stringify({
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
                })
            });

            if (response.status === 429 || response.status === 503) {
                if (!rotateToNextKey()) {
                    return { error: "All Gemini API keys have reached their quota limit.", allExhausted: true };
                }
                continue;
            }

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                const msg = errData?.error?.message || `HTTP ${response.status}`;

                if (msg.includes('RESOURCE_EXHAUSTED') || msg.toLowerCase().includes('quota')) {
                    if (!rotateToNextKey()) {
                        return { error: "All Gemini API keys have reached their quota limit.", allExhausted: true };
                    }
                    continue;
                }
                if (response.status === 400 || response.status === 401 || response.status === 403) {
                    if (!rotateToNextKey()) {
                        return { error: "All Gemini API keys have reached their quota limit.", allExhausted: true };
                    }
                    continue;
                }
                throw new Error(msg);
            }

            const data = await response.json();
            const parts = data?.candidates?.[0]?.content?.parts || [];

            let imageData = null;
            let textNote = '';
            for (const part of parts) {
                if (part.inlineData?.data) {
                    imageData = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
                } else if (part.text) {
                    textNote += part.text;
                }
            }

            if (!imageData) {
                throw new Error("No image returned. Try a different prompt.");
            }

            return { image: imageData, note: textNote };

        } catch (err) {
            if (err.name === 'AbortError') return { aborted: true };
            if (err.message?.toLowerCase().includes('failed to fetch')) {
                return { error: "Network error — check your internet connection.", network: true };
            }
            throw err;
        }
    }

    return { error: "All Gemini API keys have reached their quota limit.", allExhausted: true };
}
async function handleSendMessage() {
    if (isGenerating) return;

    const text = dom.messageInput.value.trim();
    if (!text) return;

    dom.welcome.style.display = 'none';

    appendMessage(escHtml(text), 'user');
    persistMessage('user', text);
    SND.send();

    dom.messageInput.value = '';
    autoResizeInput();
    updateFooterStats();

    await sendToGemini(text);
}

async function sendToGemini(text) {
    setSendingState(true);

    // FEATURE 7: Thinking -> Typing transition for a smoother feel
    const loadingDiv = createLoadingBubble('Thinking');
    await new Promise(r => setTimeout(r, 220));
    dom.messagesContainer.appendChild(loadingDiv);
    scrollToBottom();

    setStatus('thinking');
    abortController = new AbortController();
    const startTime = performance.now();

    try {
        const result = await callGemini(text, abortController.signal);

        // brief "Typing..." flash right before the content lands
        if (!result?.aborted && !result?.error) {
            setLoadingLabel(loadingDiv, 'Typing');
            await new Promise(r => setTimeout(r, 180));
        }

        loadingDiv.remove();
        setStatus('idle');

        if (!result) return;

        if (result.aborted) {
            appendMessage('<em>Generation stopped.</em>', 'assistant');
            persistMessage('assistant', '_Generation stopped._');
            return;
        }

        if (result.error) {
            renderErrorBubble(result.error, text);
            SND.error();
            return;
        }

        const latencyMs = performance.now() - startTime;
        const meta = { latency: latencyMs };
        appendMessage(renderMarkdown(result.reply), 'assistant', meta);
        persistMessage('assistant', result.reply, meta);
        SND.receive();
        speakText(result.reply);

    } catch (error) {
        loadingDiv.remove();
        setStatus('idle');
        renderErrorBubble(error.message || String(error), text);
        SND.error();
        console.error(error);
    } finally {
        setSendingState(false);
        abortController = null;
    }
}

function setSendingState(generating) {
    isGenerating = generating;
    if (generating) {
        dom.sendIcon.style.display = 'none';
        dom.stopIcon.style.display = '';
        dom.sendBtn.classList.add('stop-mode');
        dom.sendBtn.removeAttribute('disabled');
        dom.sendBtn.title = 'Stop generation';
    } else {
        dom.sendIcon.style.display = '';
        dom.stopIcon.style.display = 'none';
        dom.sendBtn.classList.remove('stop-mode');
        dom.sendBtn.title = '';
        updateSendState();
    }
}

dom.sendBtn.addEventListener('click', () => {
    if (isGenerating) {
        if (abortController) abortController.abort();
    } else {
        handleSendMessage();
    }
});

dom.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
    }
});

// ══════════════════════════════════════════════════════════════
//  IMAGE GENERATION BUTTON
// ══════════════════════════════════════════════════════════════
dom.imageBtn.addEventListener('click', () => {
    if (isGenerating) return;
    const prompt = dom.messageInput.value.trim();
    if (!prompt) {
        showToast('Type a prompt first, then tap 🖼️', 'error');
        dom.messageInput.focus();
        return;
    }
    handleGenerateImage(prompt);
});

async function handleGenerateImage(prompt) {
    dom.welcome.style.display = 'none';

    appendMessage(escHtml(prompt), 'user');
    persistMessage('user', prompt);
    SND.send();

    dom.messageInput.value = '';
    autoResizeInput();
    updateFooterStats();

    setSendingState(true);
    dom.imageBtn.classList.add('generating');

    const loadingDiv = createLoadingBubble('Generating image');
    dom.messagesContainer.appendChild(loadingDiv);
    scrollToBottom();

    setStatus('thinking');
    abortController = new AbortController();
    const startTime = performance.now();

    try {
        const result = await generateImage(prompt, abortController.signal);
        loadingDiv.remove();
        setStatus('idle');

        if (result.aborted) {
            appendMessage('<em>Generation stopped.</em>', 'assistant');
            persistMessage('assistant', '_Generation stopped._');
            return;
        }

        if (result.error) {
            renderErrorBubble(result.error, null);
            SND.error();
            return;
        }

        const latencyMs = performance.now() - startTime;
        appendImageMessage(result.image, result.note, prompt, { latency: latencyMs });
        SND.receive();

    } catch (error) {
        loadingDiv.remove();
        setStatus('idle');
        renderErrorBubble(error.message || String(error), null);
        SND.error();
        console.error(error);
    } finally {
        setSendingState(false);
        abortController = null;
        dom.imageBtn.classList.remove('generating');
    }
}

function appendImageMessage(dataUrl, note, prompt, meta) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const bubbleContent = document.createElement('div');
    bubbleContent.className = 'bubble-content generated-image-wrapper';

    let html = '';
    if (note && note.trim()) html += renderMarkdown(note.trim());
    html += `<img class="generated-image" src="${dataUrl}" alt="Generated image">`;
    html += `<div class="img-actions">
        <span class="meta-btn img-download-btn" title="Download image">⬇️ Download</span>
        <span class="meta-btn img-retry-btn" title="Regenerate">🔄 Regenerate</span>
    </div>`;
    bubbleContent.innerHTML = html;

    bubble.appendChild(bubbleContent);

    if (meta && meta.latency) {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'response-meta';
        metaDiv.innerHTML = `<span>Generated in ${(meta.latency / 1000).toFixed(1)}s</span>`;
        bubble.appendChild(metaDiv);
    }

    msgDiv.appendChild(bubble);
    dom.messagesContainer.appendChild(msgDiv);

    bubbleContent.querySelector('.img-download-btn').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `softarmory-image-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast('Image downloaded!', 'success');
    });

    bubbleContent.querySelector('.img-retry-btn').addEventListener('click', () => {
        if (isGenerating) return;
        msgDiv.remove();
        handleRegenerateImage(prompt);
    });

    persistMessage('assistant', `[Generated image for: "${prompt}"]`, meta);
    scrollToBottom();
}

async function handleRegenerateImage(prompt) {
    setSendingState(true);
    dom.imageBtn.classList.add('generating');
    const loadingDiv = createLoadingBubble('Generating image');
    dom.messagesContainer.appendChild(loadingDiv);
    scrollToBottom();
    setStatus('thinking');
    abortController = new AbortController();
    const startTime = performance.now();

    try {
        const result = await generateImage(prompt, abortController.signal);
        loadingDiv.remove();
        setStatus('idle');

        if (result.aborted) return;

        if (result.error) {
            renderErrorBubble(result.error, null);
            SND.error();
            return;
        }

        const latencyMs = performance.now() - startTime;
        appendImageMessage(result.image, result.note, prompt, { latency: latencyMs });
        SND.receive();

    } catch (error) {
        loadingDiv.remove();
        setStatus('idle');
        renderErrorBubble(error.message || String(error), null);
        SND.error();
    } finally {
        setSendingState(false);
        abortController = null;
        dom.imageBtn.classList.remove('generating');
    }
}

// ══════════════════════════════════════════════════════════════
//  RENDERING HELPERS
// ══════════════════════════════════════════════════════════════
function createLoadingBubble(label = 'Thinking') {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant';
    loadingDiv.innerHTML = `
        <div class="bubble">
            <div class="bubble-content sa-loading-bubble" style="display:flex;gap:8px;align-items:center">
                <span class="sa-loading-label">${label}</span>
                <span style="display:flex;gap:5px">
                    <span style="animation:sa-blink 1.2s infinite 0s;font-size:18px">●</span>
                    <span style="animation:sa-blink 1.2s infinite .2s;font-size:18px">●</span>
                    <span style="animation:sa-blink 1.2s infinite .4s;font-size:18px">●</span>
                </span>
            </div>
        </div>`;

    if (!document.getElementById('sa-blink-style')) {
        const s = document.createElement('style');
        s.id = 'sa-blink-style';
        s.textContent = '@keyframes sa-blink{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}} .sa-loading-label{font-size:13px;color:var(--text-dim)}';
        document.head.appendChild(s);
    }
    return loadingDiv;
}

function setLoadingLabel(loadingDiv, label) {
    const span = loadingDiv?.querySelector('.sa-loading-label');
    if (span) span.textContent = label;
}

function renderErrorBubble(message, retryText) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'message assistant';
    msgDiv.innerHTML = `
        <div class="bubble">
            <div class="bubble-content error-bubble">
                <div class="error-title">⚠️ Connection Error</div>
                <div>${escHtml(message)}</div>
            </div>
        </div>`;

    if (retryText) {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'response-meta';
        metaDiv.innerHTML = `<span class="meta-btn retry-btn" title="Retry">🔄 Retry</span>`;
        metaDiv.querySelector('.retry-btn').addEventListener('click', () => {
            if (isGenerating) return;
            msgDiv.remove();
            sendToGemini(retryText);
        });
        msgDiv.querySelector('.bubble').appendChild(metaDiv);
    }

    dom.messagesContainer.appendChild(msgDiv);
    scrollToBottom();
}

function appendMessage(html, sender, meta, scroll = true) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${sender}`;

    const bubbleContent = document.createElement('div');
    bubbleContent.className = 'bubble-content';
    bubbleContent.innerHTML = html;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.appendChild(bubbleContent);

    const isStopped = html.includes('Generation stopped');

    if (sender === 'assistant' && !isStopped) {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'response-meta';
        let metaHtml = '';
        if (meta && meta.latency) {
            metaHtml += `<span>Response in ${(meta.latency / 1000).toFixed(1)}s</span>`;
        }
        metaHtml += `<span class="meta-btn copy-btn" title="Copy response">📋</span>`;
        metaHtml += `<span class="meta-btn retry-btn" title="Retry">🔄</span>`;
        metaHtml += `<span class="meta-btn speak-btn" title="Read aloud">🔊</span>`;
        metaDiv.innerHTML = metaHtml;
        bubble.appendChild(metaDiv);

        metaDiv.querySelector('.speak-btn').addEventListener('click', () => {
            speakText(bubbleContent.textContent);
        });

        metaDiv.querySelector('.copy-btn').addEventListener('click', () => {
            const copyBtn = metaDiv.querySelector('.copy-btn');
            navigator.clipboard.writeText(bubbleContent.textContent).then(() => {
                showToast('Response copied!', 'success');
                copyBtn.textContent = '✅';
                setTimeout(() => copyBtn.textContent = '📋', 1200);
            }).catch(() => showToast('Copy failed', 'error'));
        });

        metaDiv.querySelector('.retry-btn').addEventListener('click', () => {
            retryFromMessage(msgDiv);
        });
    }

    if (sender === 'user') {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'response-meta user-meta';
        metaDiv.innerHTML = `<span class="meta-btn edit-btn" title="Edit & resend">✏️</span>`;
        bubble.appendChild(metaDiv);

        metaDiv.querySelector('.edit-btn').addEventListener('click', () => {
            startEditMessage(msgDiv, bubbleContent);
        });
    }

    msgDiv.appendChild(bubble);
    dom.messagesContainer.appendChild(msgDiv);

    // FEATURE 2: Copy buttons for code blocks
    enhanceCodeBlocks(bubbleContent);

    if (scroll) scrollToBottom();
}

// ══════════════════════════════════════════════════════════════
//  RETRY — regenerate the assistant response for the preceding user msg
// ══════════════════════════════════════════════════════════════
function retryFromMessage(assistantMsgDiv) {
    if (isGenerating) return;

    // Find the preceding user message in the DOM
    let userMsgDiv = assistantMsgDiv.previousElementSibling;
    while (userMsgDiv && !userMsgDiv.classList.contains('user')) {
        userMsgDiv = userMsgDiv.previousElementSibling;
    }
    if (!userMsgDiv) {
        showToast('Nothing to retry', 'error');
        return;
    }

    const userText = userMsgDiv.querySelector('.bubble-content').textContent;

    // Remove this assistant message + trim history/persisted record
    assistantMsgDiv.remove();
    if (conversationHistory.length >= 2) {
        conversationHistory.splice(-2, 2); // drop last user+model turn
    }
    if (currentChatId && chats[currentChatId]) {
        const msgs = chats[currentChatId].messages;
        // remove trailing assistant message
        for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'assistant') { msgs.splice(i, 1); break; }
            if (msgs[i].role === 'user') break;
        }
        chats[currentChatId].history = conversationHistory;
        saveChats();
    }

    sendToGemini(userText);
}

// ══════════════════════════════════════════════════════════════
//  EDIT & RESEND — user message
// ══════════════════════════════════════════════════════════════
function startEditMessage(msgDiv, bubbleContent) {
    if (isGenerating) return;
    if (msgDiv.querySelector('.edit-textarea')) return; // already editing

    const originalText = bubbleContent.textContent;
    const editArea = document.createElement('textarea');
    editArea.className = 'edit-textarea';
    editArea.value = originalText;

    const actions = document.createElement('div');
    actions.className = 'edit-actions';
    actions.innerHTML = `
        <button class="edit-save-btn">Save &amp; Resend</button>
        <button class="edit-cancel-btn">Cancel</button>`;

    bubbleContent.style.display = 'none';
    msgDiv.querySelector('.bubble').insertBefore(editArea, bubbleContent.nextSibling);
    msgDiv.querySelector('.bubble').insertBefore(actions, editArea.nextSibling);

    editArea.focus();
    autoResizeTextarea(editArea);
    editArea.addEventListener('input', () => autoResizeTextarea(editArea));

    actions.querySelector('.edit-cancel-btn').addEventListener('click', () => {
        editArea.remove();
        actions.remove();
        bubbleContent.style.display = '';
    });

    actions.querySelector('.edit-save-btn').addEventListener('click', () => {
        const newText = editArea.value.trim();
        if (!newText) return;

        // Remove everything from this message onward in DOM
        let node = msgDiv;
        const toRemove = [];
        while (node) {
            toRemove.push(node);
            node = node.nextElementSibling;
        }
        toRemove.forEach(n => n.remove());

        // Trim conversationHistory: each user+model pair = 2 entries.
        // Find how many turns precede this message by counting prior user messages.
        let priorUserCount = 0;
        let sib = msgDiv.previousElementSibling;
        // msgDiv already removed from DOM at this point? It's in toRemove but not yet detached when counted.
        // Recompute using persisted chat record instead (more reliable).
        if (currentChatId && chats[currentChatId]) {
            const msgs = chats[currentChatId].messages;
            const idx = msgs.findIndex(m => m.role === 'user' && m.content === originalText);
            if (idx !== -1) {
                chats[currentChatId].messages = msgs.slice(0, idx);
                priorUserCount = chats[currentChatId].messages.filter(m => m.role === 'user').length;
            }
        }
        conversationHistory = conversationHistory.slice(0, priorUserCount * 2);
        if (currentChatId && chats[currentChatId]) {
            chats[currentChatId].history = conversationHistory;
            saveChats();
        }

        dom.messageInput.value = newText;
        autoResizeInput();
        updateSendState();
        handleSendMessage();
    });
}

function autoResizeTextarea(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
}

// ══════════════════════════════════════════════════════════════
//  FEATURE 3: SMOOTH RELIABLE AUTO-SCROLL
// ══════════════════════════════════════════════════════════════
function scrollToBottom(instant = false) {
    requestAnimationFrame(() => {
        dom.messages.scrollTo({
            top: dom.messages.scrollHeight,
            behavior: instant ? 'auto' : 'smooth'
        });
    });
}

// ══════════════════════════════════════════════════════════════
//  ESCAPING & MARKDOWN RENDERING (with Prism syntax highlighting)
// ══════════════════════════════════════════════════════════════
function escHtml(s) {
    return String(s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;')
        .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMarkdown(raw) {
    let html = escHtml(raw);

    // Code blocks with language tagging for Prism
    html = html.replace(/```([\w]*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        const language = (lang || 'plaintext').toLowerCase();
        const prismClass = `language-${language}`;
        return `<div class="code-block-wrapper" data-code="${encodeURIComponent(code)}">` +
               `<button class="code-copy-btn">Copy</button>` +
               `<pre style="background:rgba(0,0,0,0.4);border:1px solid rgba(0,245,255,0.12);border-radius:10px;padding:12px;overflow-x:auto;margin:8px 0;font-size:13px"><code class="${prismClass}" style="font-family:'JetBrains Mono',monospace;color:#00f5ff">${code}</code></pre>` +
               `</div>`;
    });

    html = html
        .replace(/`([^`\n]+)`/g,
            '<code style="background:rgba(0,245,255,0.08);padding:2px 6px;border-radius:5px;font-family:monospace;color:#00f5ff">$1</code>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^### (.+)$/gm, '<h3 style="font-size:1rem;font-weight:600;margin:10px 0 4px;color:#e8f7ff">$1</h3>')
        .replace(/^## (.+)$/gm,  '<h2 style="font-size:1.1rem;font-weight:600;margin:12px 0 4px;color:#e8f7ff">$1</h2>')
        .replace(/^# (.+)$/gm,   '<h1 style="font-size:1.2rem;font-weight:700;margin:14px 0 5px;color:#e8f7ff">$1</h1>')
        .replace(/^[•\-\*] (.+)$/gm,
            '<div style="display:flex;gap:8px;margin:2px 0"><span style="color:#00f5ff">▸</span><span>$1</span></div>')
        .replace(/^(\d+)\. (.+)$/gm,
            '<div style="display:flex;gap:8px;margin:2px 0"><span style="color:#00f5ff;min-width:18px">$1.</span><span>$2</span></div>')
        .replace(/\n\n/g, '<br><br>')
        .replace(/\n/g, '<br>');

    return html;
}

function enhanceCodeBlocks(container) {
    const wrappers = container.querySelectorAll('.code-block-wrapper');
    wrappers.forEach(wrapper => {
        const codeEl = wrapper.querySelector('code');
        // Prism highlight
        if (window.Prism && codeEl) {
            try { Prism.highlightElement(codeEl); } catch (e) { /* ignore */ }
        }

        const copyBtn = wrapper.querySelector('.code-copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const code = decodeURIComponent(wrapper.dataset.code || '');
                navigator.clipboard.writeText(code).then(() => {
                    copyBtn.textContent = 'Copied!';
                    copyBtn.classList.add('copied');
                    showToast('Code copied!', 'success');
                    setTimeout(() => {
                        copyBtn.textContent = 'Copy';
                        copyBtn.classList.remove('copied');
                    }, 1800);
                }).catch(() => {
                    showToast('Copy failed', 'error');
                });
            });
        }
    });
}

// ══════════════════════════════════════════════════════════════
//  SUGGESTIONS — click populates AND sends
// ══════════════════════════════════════════════════════════════
document.querySelectorAll('.suggestion').forEach(item => {
    item.addEventListener('click', () => {
        const prompt = item.getAttribute('data-prompt');
        dom.messageInput.value = prompt;
        autoResizeInput();
        updateSendState();
        updateFooterStats();
        handleSendMessage();
    });
});

// ══════════════════════════════════════════════════════════════
//  FEATURE 16/4: CLEAR & EXPORT
// ══════════════════════════════════════════════════════════════
dom.clearBtn.addEventListener('click', () => {
    if (isGenerating && abortController) abortController.abort();
    startNewChat();
    SND.toggle();
    showToast('Chat Cleared!', 'success');
});

dom.exportBtn.addEventListener('click', () => {
    const chat = currentChatId ? chats[currentChatId] : null;
    const messages = chat ? chat.messages : [];

    if (messages.length === 0) {
        showToast('Nothing to export', 'error');
        return;
    }

    const exportData = {
        title: chat.title,
        exportedAt: new Date().toISOString(),
        messages: messages.map(m => ({ role: m.role, content: m.content }))
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `softarmory-chat-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showToast('Chat exported!', 'success');
});

// ══════════════════════════════════════════════════════════════
//  NEW CHAT BUTTON
// ══════════════════════════════════════════════════════════════
dom.newChatBtn.addEventListener('click', () => {
    startNewChat();
    SND.toggle();
});

// ══════════════════════════════════════════════════════════════
//  MOBILE SIDEBAR
// ══════════════════════════════════════════════════════════════
if (dom.mobileMenuBtn) {
    dom.mobileMenuBtn.addEventListener('click', () => {
        dom.sidebar.classList.add('open');
        dom.overlay.classList.add('show');
    });
}

if (dom.overlay) {
    dom.overlay.addEventListener('click', () => {
        dom.sidebar.classList.remove('open');
        dom.overlay.classList.remove('show');
    });
}

// ══════════════════════════════════════════════════════════════
//  TOGGLES (Particles, Sound, Voice) + persistence
// ══════════════════════════════════════════════════════════════
document.querySelectorAll('.toggle').forEach(toggle => {
    toggle.addEventListener('click', () => {
        toggle.classList.toggle('active');
        SND.toggle();
        saveSettings();

        if (toggle === dom.particleToggle) {
            setParticlesEnabled(toggle.classList.contains('active'));
        }
        if (toggle === dom.voiceToggle) {
            if (toggle.classList.contains('active')) {
                showToast('Voice reply enabled', 'success');
            } else {
                window.speechSynthesis?.cancel();
            }
        }
    });
});

// ══════════════════════════════════════════════════════════════
//  TEMPERATURE SLIDER
// ══════════════════════════════════════════════════════════════
if (dom.tempSlider && dom.tempVal) {
    dom.tempSlider.addEventListener('input', (e) => {
        dom.tempVal.textContent = e.target.value;
    });
    dom.tempSlider.addEventListener('change', saveSettings);
}

dom.modelSelect.addEventListener('change', saveSettings);

// ══════════════════════════════════════════════════════════════
//  FEATURE 13: SYSTEM INSTRUCTION CUSTOMIZER
// ══════════════════════════════════════════════════════════════
dom.sysInstructToggleLabel.addEventListener('click', () => {
    const ta = dom.customSystemInstruction;
    const span = dom.sysInstructToggleLabel.querySelector('span');
    if (ta.style.display === 'none') {
        ta.style.display = 'block';
        span.textContent = 'Custom Instructions ▴';
    } else {
        ta.style.display = 'none';
        span.textContent = 'Custom Instructions ▾';
    }
});

dom.customSystemInstruction.addEventListener('change', saveSettings);

// ══════════════════════════════════════════════════════════════
//  FEATURE 18: DRAG AND DROP FILE UI FEEDBACK
// ══════════════════════════════════════════════════════════════
let dragCounter = 0;

['dragenter', 'dragover'].forEach(evt => {
    document.addEventListener(evt, (e) => {
        e.preventDefault();
        dragCounter++;
        dom.dropOverlay.classList.add('show');
    });
});

['dragleave', 'drop'].forEach(evt => {
    document.addEventListener(evt, (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dom.dropOverlay.classList.remove('show');
        }
    });
});

document.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
        showToast(`📎 ${files[0].name} attached (preview only)`, 'success');
        dom.messageInput.value += (dom.messageInput.value ? ' ' : '') + `[Attached file: ${files[0].name}]`;
        autoResizeInput();
        updateSendState();
        updateFooterStats();
    }
});

dom.attachBtn.addEventListener('click', () => {
    dom.fileInput.click();
});

dom.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        showToast(`📎 ${file.name} attached (preview only)`, 'success');
        dom.messageInput.value += (dom.messageInput.value ? ' ' : '') + `[Attached file: ${file.name}]`;
        autoResizeInput();
        updateSendState();
        updateFooterStats();
    }
});

// ══════════════════════════════════════════════════════════════
//  PARTICLE SYSTEM (toggleable, optimized)
// ══════════════════════════════════════════════════════════════
let particlesArray = [];
let particleAnimFrame = null;
let particlesEnabled = true;
let ctx = null;

function initParticles() {
    if (!dom.canvas) return;
    ctx = dom.canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    class Particle {
        constructor() {
            this.x = Math.random() * dom.canvas.width;
            this.y = Math.random() * dom.canvas.height;
            this.size = Math.random() * 1.5 + 0.5;
            this.speedX = Math.random() * 0.4 - 0.2;
            this.speedY = Math.random() * 0.4 - 0.2;
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            if (this.x > dom.canvas.width  || this.x < 0) this.speedX *= -1;
            if (this.y > dom.canvas.height || this.y < 0) this.speedY *= -1;
        }
        draw() {
            ctx.fillStyle = 'rgba(0, 245, 255, 0.3)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    particlesArray = [];
    for (let i = 0; i < 45; i++) particlesArray.push(new Particle());

    particlesEnabled = dom.particleToggle.classList.contains('active');
    if (particlesEnabled) startParticleLoop();
}

function resizeCanvas() {
    if (!dom.canvas) return;
    dom.canvas.width = window.innerWidth;
    dom.canvas.height = window.innerHeight;
}

function animateParticles() {
    if (!ctx) return;
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update();
        particlesArray[i].draw();
    }
    particleAnimFrame = requestAnimationFrame(animateParticles);
}

function startParticleLoop() {
    if (particleAnimFrame) return;
    animateParticles();
}

function stopParticleLoop() {
    if (particleAnimFrame) {
        cancelAnimationFrame(particleAnimFrame);
        particleAnimFrame = null;
    }
    if (ctx) ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
}

function setParticlesEnabled(enabled) {
    particlesEnabled = enabled;
    if (enabled) startParticleLoop();
    else stopParticleLoop();
}

// ══════════════════════════════════════════════════════════════
//  STARTUP KEY CHECK (no network call — instant, doesn't block input)
// ══════════════════════════════════════════════════════════════
function checkKeysConfigured() {
    if (GEMINI_KEYS.length === 0) {
        console.error('[SoftArmory] No API keys configured! Add at least one key to RAW_KEYS.');
        setStatus('offline');
    } else {
        console.log(`[SoftArmory] ${GEMINI_KEYS.length} key(s) loaded.`);
    }
}

// ══════════════════════════════════════════════════════════════
//  INIT — runs immediately, input is interactive from frame 1
// ══════════════════════════════════════════════════════════════
function init() {
    // Critical path: enable input + restore settings first
    loadSettings();
    updateSendState();
    autoResizeInput();
    updateFooterStats();

    // Everything else can happen right after without blocking typing
    loadChats();
    renderHistory();
    setupSpeechRecognition();
    checkKeysConfigured();

    // Particles are purely decorative — defer slightly so they never
    // compete with first paint / first keystroke
    requestAnimationFrame(() => initParticles());
}

init();