const CONFIG = {
    initialDelay: 8000,
    notificationDuration: 8000, 
    // TODO: Change these URLs to your production server (e.g., https://your-app.onrender.com)
    apiUrl: 'http://localhost:3000/api/chat',
    notifyUrl: 'http://localhost:3000/api/notify' 
};

let launcher, notification, chatWindow, messagesContainer, typingIndicator, inputField;
let isChatOpen = false;
let hasInitialized = false;
let highlightTooltip = null; 
let currentSentiment = 'neutral'; 
let isSoundEnabled = false;       
let focusOverlay = null;
let focusTimer = null;
let sectionTimers = {};          
let triggeredSections = new Set(); 
let nudgeCount = 0;              
const MAX_NUDGES = 2;            
let hasExitIntentTriggered = false;
let lastExitIntentTime = 0;      
let interactionCount = 0;        
let hasAskedForLead = false;     
let pendingNavigation = null;
let isMatrixMode = false;
const MEMORY_EXPIRY_HOURS = 24; 
let hasNotifiedOpen = false;

let rageClickCount = 0;
let rageClickTimer = null;
let hasTriggeredRageAssist = false;

let hasRated = false;
let ratingVisible = false;

// Example Achievements configuration
const achievements = {
    'EXPLORER': { title: 'Explorer', desc: 'Visit the whole site (scroll down).', icon: '🗺️' },
    'HEADHUNTER': { title: 'Headhunter', desc: 'Download my Resume.', icon: '📄' },
    'CHATTY': { title: 'Conversational', desc: 'Exchange 5 messages.', icon: '💬' },
    'HACKER': { title: 'The One', desc: 'Find Matrix mode (/matrix).', icon: '💊' },
    'DEV_INSPECT': { title: 'Code Reviewer', desc: 'Check source code (/source).', icon: '🧐' }
};
let unlockedAchievements = new Set(JSON.parse(localStorage.getItem('bot_achievements') || '[]'));
let slashMenu = null;
let activeSlashIndex = 0;

// Slash commands configuration
let slashCommands = [
    { cmd: '/cv', desc: 'Download Resume (PDF)', action: () => window.downloadCV() },
    { cmd: '/source', desc: 'View Source Code', action: () => fetchSourceCode() },
    { cmd: '/matrix', desc: 'Toggle Hacker Mode', action: () => toggleMatrixMode() },
    { cmd: '/trophies', desc: 'View Achievements', action: () => showAchievements() },
    { cmd: '/contact', desc: 'Go to Contact', action: () => handleNavigationCommand('/contact') },
    { cmd: '/reset', desc: 'Clear History', action: () => requestResetConfirmation() },
    { cmd: '/export', desc: 'Download Chat', action: () => exportChat() }
];

const QUICK_REPLIES = [
    "What is your work process?",
    "How much does a project cost?",
    "What services do you offer?",
    "I want a custom offer",
    "What technologies do you use?"
];

// --- API & Notification Functions ---

async function notifyTelegram(type, data = {}) {
    try {
        await fetch(CONFIG.notifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, data })
        });
    } catch (e) {
        console.error("Failed to notify Telegram:", e);
    }
}

window.triggerNotification = function(title, text) {
    if (isChatOpen) return; 

    const notif = document.getElementById('azzis-notification');
    if (!notif) return;

    notif.innerHTML = `
        <div style="flex:1">
            <div class="notif-header">${title}</div>
            <div class="notif-body">${text}</div>
        </div>
    `;

    notif.classList.add('active');
    
    if(isSoundEnabled) {
        const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3');
        audio.volume = 0.2;
        audio.play().catch(e => {});
    }

    setTimeout(() => {
        notif.classList.remove('active');
    }, CONFIG.notificationDuration);
};

function removeQuickReplies() {
    const chips = messagesContainer.querySelector('.quick-replies-wrapper');
    if (chips) {
        chips.style.opacity = '0';
        setTimeout(() => chips.remove(), 200);
    }
}

window.openProjectModal = function(projectId) {
    // Looks for a DOM element with data-project attribute
    const projectCard = document.querySelector(`.work-card[data-project="${projectId}"]`);
    if (projectCard) {
        projectCard.click();
        if (window.innerWidth < 480) toggleChat();
    } else {
        addMessage("I couldn't open that project automatically. Please check the Work section.", 'bot');
    }
};

window.prefillContactForm = function(intentType) {
    const messageField = document.getElementById('contact-message'); // ID of your contact textarea
    const emailField = document.getElementById('contact-email'); // ID of your email input
    
    if (!messageField) return;

    let textToFill = "";
    if (intentType === 'general') {
        textToFill = "Hello! I visited your site and would like to discuss a potential collaboration.";
    } else if (intentType === 'web') {
        textToFill = "Hi! I am interested in a website / online store. I would like a quote.";
    }

    messageField.value = textToFill;
    messageField.style.transition = "background 0.3s";
    messageField.style.backgroundColor = "rgba(105, 0, 144, 0.2)"; 
    setTimeout(() => messageField.style.backgroundColor = "", 1000);
    
    if (emailField) emailField.focus();

    addMessage("I've filled in the message for you! ✅ Just add your email and hit Send.", 'bot');
    if (window.innerWidth < 768) toggleChat();
};

window.downloadCV = function() {
    // TODO: Replace with your actual CV path
    const link = document.createElement('a');
    link.href = '/path/to/your/resume.pdf'; 
    link.download = 'Resume.pdf';
    link.target = '_blank'; 
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    triggerConfetti();
    unlockAchievement('HEADHUNTER');
    addMessage("Download started! Thanks for your interest! 🎉", 'bot');
};

// --- History & Reset Functions ---

window.requestResetConfirmation = function() {
    messagesContainer.classList.add('blurred-content');
    const existingModal = document.querySelector('.reset-modal-overlay');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.className = 'reset-modal-overlay';
    modal.innerHTML = `
        <div class="reset-modal-card">
            <div class="reset-icon">⚠️</div>
            <div class="reset-title">Clear History?</div>
            <div class="reset-desc">This action is irreversible and will delete the conversation.</div>
            <div class="reset-actions">
                <button onclick="confirmReset()" class="reset-btn-yes">Yes, clear</button>
                <button onclick="cancelReset()" class="reset-btn-no">Cancel</button>
            </div>
        </div>
    `;
    chatWindow.appendChild(modal);
};

window.confirmReset = function() {
    clearChatHistory();
    closeResetModal();
};

window.cancelReset = function() {
    closeResetModal();
};

function closeResetModal() {
    const modal = document.querySelector('.reset-modal-overlay');
    if (modal) modal.remove();
    messagesContainer.classList.remove('blurred-content');
}

// --- Effects & Achievements ---

function triggerConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    const colors = ['#690090', '#ef4444', '#10b981', '#f59e0b', '#ffffff'];

    for (const color of colors) {
        const confetto = document.createElement('div');
        confetto.className = 'confetti-particle';
        confetto.style.backgroundColor = color;
        confetto.style.left = Math.random() * 100 + 'vw';
        confetto.style.animation = `fall-confetti ${Math.random() * 2 + 1}s linear forwards`;
        container.appendChild(confetto);
    }
    setTimeout(() => container.remove(), 4000);
}

function unlockAchievement(id) {
    if (unlockedAchievements.has(id)) return;

    const ach = achievements[id];
    if (!ach) return;

    unlockedAchievements.add(id);
    localStorage.setItem('bot_achievements', JSON.stringify([...unlockedAchievements]));

    triggerNotification("Achievement Unlocked! 🏆", `${ach.icon} ${ach.title}: ${ach.desc}`);

    const audio = new Audio('https://assets.mixkit.co/sfx/preview/mixkit-software-interface-start-2574.mp3'); 
    audio.volume = 0.4;
    audio.play().catch(e => {}); 
}

function showAchievements() {
    const existingView = document.getElementById('azzis-achievements-view');
    if (existingView) {
        existingView.remove();
        return;
    }

    let listHTML = '<div class="ach-list">';
    
    for (const [id, ach] of Object.entries(achievements)) {
        const isUnlocked = unlockedAchievements.has(id);
        const statusClass = isUnlocked ? 'unlocked' : 'locked';
        const icon = isUnlocked ? ach.icon : '🔒';
        const title = isUnlocked ? ach.title : '??? (Secret)';
        
        listHTML += `<div class="ach-item ${statusClass}"><div class="ach-icon-wrapper">${icon}</div><div class="ach-info"><div class="ach-title">${title}</div><div class="ach-desc">${ach.desc}</div></div></div>`;
    }
    listHTML += '</div>';
    
    const total = Object.keys(achievements).length;
    const current = unlockedAchievements.size;
    const view = document.createElement('div');
    view.id = 'azzis-achievements-view';
    view.className = 'achievements-overlay';
    view.innerHTML = `
        <div class="ach-header">
            <button onclick="closeAchievementsView()" class="back-btn">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                Back
            </button>
            <span>Trophies (${current}/${total})</span>
        </div>
        <div class="ach-content">
            ${listHTML}
        </div>
    `;

    chatWindow.appendChild(view);
    requestAnimationFrame(() => view.classList.add('active'));
}

window.closeAchievementsView = function() {
    const view = document.getElementById('azzis-achievements-view');
    if (view) {
        view.classList.remove('active');
        setTimeout(() => view.remove(), 300);
    }
}

// --- Event Listeners & Initialization ---

window.addEventListener('scroll', () => {
    if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 50) {
        unlockAchievement('EXPLORER');
    }
});

window.addEventListener('load', () => {
    if(typeof marked !== 'undefined') {
        marked.setOptions({ breaks: true, gfm: true });
    }

    launcher = document.getElementById('azzis-launcher');
    notification = document.getElementById('azzis-notification');
    chatWindow = document.getElementById('azzis-chat-window');
    messagesContainer = document.getElementById('azzis-messages');
    typingIndicator = document.getElementById('azzis-typing');
    inputField = document.getElementById('azzis-input');
    
    if(notification) {
        notification.onclick = () => {
            toggleChat();
            notification.classList.remove('active');
        };
    }

    injectFocusOverlay(); 
    injectHeaderControls(); 
    injectVisualizer();
    injectInputControls(); 
    injectBranding(); 

    resetChat(); 
    
    checkHardwareStatus();
    initHighlightToAsk();
    initExitIntent();
    initSectionObservers();
    initSlashCommands();
    initRageClickDetector();
    initWeatherGreeting(); 

    if (!hasInitialized) {
        setTimeout(() => {
            if (!isChatOpen) {
                launcher.classList.add('visible');
                triggerNotification("Assistant", `${getTimeBasedGreeting()} Can I help you with anything?`);
            }
        }, CONFIG.initialDelay);
    } else {
        launcher.classList.add('visible');
    }
});

function injectBranding() {
    const chatWindow = document.getElementById('azzis-chat-window');
    if (!chatWindow) return;
    if (chatWindow.querySelector('.azzis-branding-footer')) return;

    // TODO: Update link to your project/site
    const footer = document.createElement('a');
    footer.href = '#'; 
    footer.target = '_blank';
    footer.className = 'azzis-branding-footer';
    footer.innerHTML = `
        <span>Powered by AI</span>
        <svg class="azzis-brand-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
    `;
    
    chatWindow.appendChild(footer);
}

function initRageClickDetector() {
    document.addEventListener('click', (e) => {
        if (isChatOpen || !chatWindow || chatWindow.contains(e.target) || launcher.contains(e.target)) return;
        
        rageClickCount++;
        clearTimeout(rageClickTimer);
        
        rageClickTimer = setTimeout(() => {
            rageClickCount = 0;
        }, 1000);

        if (rageClickCount >= 5 && !hasTriggeredRageAssist) {
            hasTriggeredRageAssist = true;
            rageClickCount = 0;
            triggerNotification("Need help?", "I see you clicking frantically. Click here and I'll help! 🛠️");
        }
    });

    let mouseVelocity = 0;
    let shakeCount = 0;
    let shakeTimer = null;

    document.addEventListener('mousemove', (e) => {
        if(isChatOpen) return;
        
        if (Math.abs(e.movementX) > 50 && Math.abs(e.movementY) < 10) {
            shakeCount++;
            clearTimeout(shakeTimer);
            shakeTimer = setTimeout(() => shakeCount = 0, 500);

            if(shakeCount > 15 && !hasTriggeredRageAssist) {
                hasTriggeredRageAssist = true;
                shakeCount = 0;
                triggerNotification("Stuck?", "I sense a disturbance in the mouse. Message me here! 🖱️");
            }
        }
    });
}

async function initWeatherGreeting() {
    if(localStorage.getItem('bot_weather_greeted')) return;

    try {
        const ipRes = await fetch('https://ipapi.co/json/');
        if(!ipRes.ok) return;
        const locData = await ipRes.json();
        const detectedCity = (locData.city || "there").toLowerCase();
        
        // TODO: Change 'galati' to your own city
        const myCityCheck = "galati"; 
        
        const lat = locData.latitude;
        const lon = locData.longitude;
        if(!lat || !lon) return;
        
        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        const weatherData = await weatherRes.json();
        
        let greetingMsg = "";
        if (detectedCity.includes(myCityCheck) || detectedCity.normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(myCityCheck)) {
            greetingMsg = `Hi! I see you are also from **${locData.city}**! Small world. 🌊`;
        } else {
            const displayCity = locData.city;
            greetingMsg = `Hello from **MyCity**! 👋 I see you are visiting from **${displayCity}**.`;
        }

        setTimeout(() => {
            if(!isChatOpen && interactionCount === 0) {
                 const cleanMsg = greetingMsg.replace(/\*\*/g, '');
                 triggerNotification("Assistant", cleanMsg);
                 
                 addMessage(greetingMsg, 'bot');
                 localStorage.setItem('bot_weather_greeted', 'true');
            }
        }, 5000);

    } catch(e) {
        console.log("Weather detection skipped");
    }
}

function injectFocusOverlay() {
    focusOverlay = document.createElement('div');
    focusOverlay.id = 'azzis-focus-overlay';
    document.body.appendChild(focusOverlay);
    focusOverlay.addEventListener('click', exitFocusMode);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') exitFocusMode();
    });
}

function enterFocusMode() {
    if (!focusOverlay) return;
    focusOverlay.classList.add('active');
    chatWindow.classList.add('spotlight-mode');
    
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
        exitFocusMode();
    }, 5000);
}

function exitFocusMode() {
    if (!focusOverlay) return;
    focusOverlay.classList.remove('active');
    chatWindow.classList.remove('spotlight-mode');
    if (focusTimer) clearTimeout(focusTimer);
}

function injectHeaderControls() {
    const controlsContainer = document.querySelector('.chat-controls');
    if (!controlsContainer) return;

    if (controlsContainer.querySelector('.burger-menu-btn')) return;

    const menuBtn = document.createElement('button');
    menuBtn.className = 'burger-menu-btn';
    menuBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>`;
    
    const dropdown = document.createElement('div');
    dropdown.className = 'azzis-dropdown';
    dropdown.innerHTML = `
        <div class="dropdown-item" id="menu-voice">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
            <span>Toggle Voice (TTS)</span>
        </div>
        <div class="dropdown-item" id="menu-export">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            <span>Export Chat</span>
        </div>
        <div class="dropdown-item" id="menu-achievements">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>
            <span>My Trophies</span>
        </div>
        <div class="dropdown-item" id="menu-reset" style="color: #ef4444;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
            <span>Reset Chat</span>
        </div>
    `;

    menuBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('show');
        menuBtn.classList.toggle('active');
    };

    dropdown.querySelector('#menu-voice').onclick = () => {
        toggleSound();
        dropdown.classList.remove('show');
    };
    
    dropdown.querySelector('#menu-export').onclick = () => {
        exportChat();
        dropdown.classList.remove('show');
    };

    dropdown.querySelector('#menu-achievements').onclick = () => {
        showAchievements();
        dropdown.classList.remove('show');
    };
    
    dropdown.querySelector('#menu-reset').onclick = () => {
        requestResetConfirmation();
        dropdown.classList.remove('show');
    };

    document.addEventListener('click', (e) => {
        if (!controlsContainer.contains(e.target)) {
            dropdown.classList.remove('show');
            menuBtn.classList.remove('active');
        }
    });

    controlsContainer.appendChild(dropdown);
    const closeBtn = controlsContainer.querySelector('.close-chat-btn');
    if (closeBtn) {
        controlsContainer.insertBefore(menuBtn, closeBtn);
    } else {
        controlsContainer.appendChild(menuBtn);
    }
}

function injectVisualizer() {
    const header = document.querySelector('.chat-header');
    if (!header || header.querySelector('.audio-visualizer')) return;

    const vizDiv = document.createElement('div');
    vizDiv.className = 'audio-visualizer';
    vizDiv.innerHTML = `
        <div class="visualizer-bar"></div>
        <div class="visualizer-bar"></div>
        <div class="visualizer-bar"></div>
        <div class="visualizer-bar"></div>
    `;
    const brand = header.querySelector('.chat-profile-brand');
    if(brand) {
        brand.parentNode.insertBefore(vizDiv, brand.nextSibling);
    }
}

function injectInputControls() {
    const inputArea = document.querySelector('.chat-input-area');
    if (!inputArea || inputArea.querySelector('.upload-btn')) return;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'azzis-file-upload';
    fileInput.accept = 'image/*';
    fileInput.onchange = handleImageUpload;
    inputArea.appendChild(fileInput);

    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '2px';
    inputArea.prepend(btnContainer);

    const uploadBtn = document.createElement('button');
    uploadBtn.className = 'upload-btn';
    uploadBtn.title = "Upload Image";
    uploadBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>`;
    uploadBtn.onclick = () => document.getElementById('azzis-file-upload').click();
    btnContainer.appendChild(uploadBtn);
}

function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    removeQuickReplies();

    const reader = new FileReader();
    reader.onload = function(e) {
        const imageUrl = e.target.result;
        
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message user';
        msgDiv.innerHTML = `<img src="${imageUrl}" class="message-image" alt="Uploaded Image"><span class="msg-time">${getCurrentTime()}</span>`;
        messagesContainer.insertBefore(msgDiv, typingIndicator);
        scrollToBottom();

        showTyping(true);
        setTimeout(() => {
            showTyping(false);
            addMessage("Image received! 🖼️ I'm running in *Client-Only* mode, but I can check its metadata.", 'bot');
            speakText("Image received.");
        }, 2000);
    };
    reader.readAsDataURL(file);
    event.target.value = '';
}

function toggleMatrixMode() {
    isMatrixMode = !isMatrixMode;
    const chat = document.getElementById('azzis-chat-window');
    
    if (isMatrixMode) {
        chat.classList.add('matrix-mode');
        unlockAchievement('HACKER'); 
        addMessage("```bash\n$ INIT MATRIX_PROTOCOL\n$ ACCESS GRANTED\n```\nWelcome to the backend, Neo. 🐇", 'bot');
    } else {
        chat.classList.remove('matrix-mode');
        addMessage("Returning to standard UI/UX.", 'bot');
    }
}

async function fetchSourceCode() {
    addMessage("Sure! Fetching the logical source core... 📡", 'bot');
    
    try {
        const demoCode = `
// Logic Core
function analyzeSentiment(text) {
    const isUrgent = /help|urgent|error/.test(text);
    return isUrgent ? 'urgent' : 'neutral';
}
        `;
        
        setTimeout(() => {
            const codeBlock = `
<div class="code-snippet-container">
    <div class="code-header">
        <span class="code-filename">bot_logic_core.js</span>
        <button class="copy-code-btn" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText)">COPY</button>
    </div>
    <pre><code class="language-javascript">${demoCode.trim()}</code></pre>
</div>
            `;
            
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message bot';
            
            msgDiv.innerHTML = "Here is a sequence of my internal logic:" + codeBlock + `<span class="msg-time">${getCurrentTime()}</span>`;
            messagesContainer.insertBefore(msgDiv, typingIndicator);
            
            if(typeof hljs !== 'undefined') hljs.highlightAll();
            
            scrollToBottom();
            
            unlockAchievement('DEV_INSPECT'); 
            
            speakText("Here is the source code.");
        }, 1500);

    } catch (e) {
        addMessage("Could not access source file at the moment.", 'bot');
    }
}

function exportChat() {
    let transcript = "--- CHAT TRANSCRIPT ---\n";
    transcript += `Generated on: ${new Date().toLocaleString()}\n\n`;

    const messages = messagesContainer.querySelectorAll('.message');
    messages.forEach(msg => {
        if (msg.classList.contains('bot-card')) return;
        
        if (msg.querySelector('img.message-image')) {
            const isBot = msg.classList.contains('bot');
            const sender = isBot ? "Assistant" : "User";
            transcript += `[IMAGE UPLOADED BY ${sender}]\n`;
            return;
        }

        const isBot = msg.classList.contains('bot');
        const sender = isBot ? "Assistant" : "User";
        
        let text = msg.innerText.replace(msg.querySelector('.msg-time')?.innerText || '', '').trim();
        let time = msg.querySelector('.msg-time')?.innerText || '';

        transcript += `[${time}] ${sender}: ${text}\n`;
        if (isBot) transcript += `-----------------------------------\n`;
    });

    transcript += "\n--- End of Transcript ---";

    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat_export_${Date.now()}.txt`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function toggleSound() {
    isSoundEnabled = !isSoundEnabled;
    const voiceItem = document.querySelector('#menu-voice');
    
    if (isSoundEnabled) {
        if(voiceItem) {
            voiceItem.classList.add('sound-active');
            voiceItem.querySelector('span').innerText = "Disable Voice";
        }
        speakText("Hello! I can now reply vocally.");
    } else {
        if(voiceItem) {
            voiceItem.classList.remove('sound-active');
            voiceItem.querySelector('span').innerText = "Enable Voice";
        }
        window.speechSynthesis.cancel(); 
    }
}

function speakText(text) {
    if (!isSoundEnabled || !window.speechSynthesis) return;
    const cleanText = text
        .replace(/\*/g, '')          
        .replace(/#/g, '')           
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') 
        .replace(/<[^>]*>/g, '')
        .replace(/`/g, '');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'en-US'; // Set to English
    utterance.rate = 1.05;     
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    
    // Try to find a Google voice or generic English voice
    const voice = voices.find(v => v.lang.includes('en') && v.name.includes('Google')) || voices.find(v => v.lang.includes('en'));
    if (voice) utterance.voice = voice;

    utterance.onstart = () => {
        const viz = document.querySelector('.audio-visualizer');
        if(viz) viz.classList.add('active');
    };
    
    utterance.onend = () => {
        const viz = document.querySelector('.audio-visualizer');
        if(viz) viz.classList.remove('active');
    };

    window.speechSynthesis.speak(utterance);
}

function renderQuickReplies() {
    const existing = messagesContainer.querySelector('.quick-replies-wrapper');
    if (existing) existing.remove();

    const wrapper = document.createElement('div');
    wrapper.className = 'quick-replies-wrapper';
    
    const header = document.createElement('div');
    header.className = 'quick-replies-header';
    header.innerText = 'Frequently Asked Questions';
    wrapper.appendChild(header);

    const container = document.createElement('div');
    container.className = 'quick-replies-container';

    let isDown = false;
    let startX;
    let scrollLeft;
    let isDragging = false; 

    container.addEventListener('mousedown', (e) => {
        isDown = true;
        isDragging = false;
        container.classList.add('active');
        startX = e.pageX - container.offsetLeft;
        scrollLeft = container.scrollLeft;
    });

    container.addEventListener('mouseleave', () => {
        isDown = false;
        container.classList.remove('active');
    });

    container.addEventListener('mouseup', () => {
        isDown = false;
        container.classList.remove('active');
    });

    container.addEventListener('mousemove', (e) => {
        if (!isDown) return;
        e.preventDefault();
        const x = e.pageX - container.offsetLeft;
        const walk = (x - startX) * 2; 
        container.scrollLeft = scrollLeft - walk;
        if (Math.abs(walk) > 5) {
            isDragging = true;
        }
    });

    QUICK_REPLIES.forEach(text => {
        const chip = document.createElement('div');
        chip.className = 'quick-chip';
        chip.innerText = text;
        chip.onclick = (e) => {
            if(isDragging) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            inputField.value = text; 
            sendChatMessage(); 
        };
        container.appendChild(chip);
    });

    wrapper.appendChild(container);
    messagesContainer.appendChild(wrapper);
    scrollToBottom();
}

function initSlashCommands() {
    slashMenu = document.createElement('div');
    slashMenu.classList.add('slash-menu');
    document.querySelector('.chat-input-area').appendChild(slashMenu);

    inputField.addEventListener('keyup', handleSlashInput);
    inputField.addEventListener('keydown', handleSlashNavigation);
}

function handleSlashInput(e) {
    const val = inputField.value;
    if (val.startsWith('/')) {
        const query = val.toLowerCase();
        const matches = slashCommands.filter(sc => sc.cmd.startsWith(query));
        
        if (matches.length > 0) {
            renderSlashMenu(matches);
            slashMenu.style.display = 'flex';
        } else {
            slashMenu.style.display = 'none';
        }
    } else {
        slashMenu.style.display = 'none';
    }
}

function renderSlashMenu(matches) {
    slashMenu.innerHTML = '';
    activeSlashIndex = 0; 
    
    matches.forEach((item, index) => {
        const div = document.createElement('div');
        div.classList.add('slash-item');
        if (index === 0) div.classList.add('active'); 
        
        div.innerHTML = `<span class="cmd-name">${item.cmd}</span><span class="cmd-desc">${item.desc}</span>`;
        div.onclick = () => executeSlashCommand(item);
        slashMenu.appendChild(div);
    });
}

function handleSlashNavigation(e) {
    if (slashMenu.style.display !== 'flex') return;
    const items = slashMenu.querySelectorAll('.slash-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[activeSlashIndex].classList.remove('active');
        activeSlashIndex = (activeSlashIndex + 1) % items.length;
        items[activeSlashIndex].classList.add('active');
        items[activeSlashIndex].scrollIntoView({ block: 'nearest' });
    } 
    else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[activeSlashIndex].classList.remove('active');
        activeSlashIndex = (activeSlashIndex - 1 + items.length) % items.length;
        items[activeSlashIndex].classList.add('active');
        items[activeSlashIndex].scrollIntoView({ block: 'nearest' });
    }
    else if (e.key === 'Enter') {
        e.preventDefault();
        items[activeSlashIndex].click();
    }
}

function executeSlashCommand(item) {
    inputField.value = ''; 
    slashMenu.style.display = 'none';
    addMessage(item.cmd, 'user');
    setTimeout(() => {
        item.action();
    }, 300);
}

function clearChatHistory() {
    localStorage.removeItem('bot_history');
    localStorage.removeItem('bot_interaction_count');
    localStorage.removeItem('bot_weather_greeted'); 
    interactionCount = 0;
    hasRated = false;
    resetChat(); 
}

function initSectionObservers() {
    // Add IDs for sections you want the bot to react to (e.g., <section id="contact">)
    const sections = [
        { id: 'contact', delay: 8000, type: 'contact', name: 'Contact' },
        { id: 'projects', delay: 12000, type: 'projects', name: 'Portfolio' }, 
        { id: 'reviews', delay: 10000, type: 'reviews', name: 'Reviews' },
        { id: 'services', delay: 10000, type: 'services', name: 'Services' }
    ];

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const sectionConfig = sections.find(s => s.id === entry.target.id);
            if (!sectionConfig) return;

            if (entry.isIntersecting) {
                localStorage.setItem('bot_last_context', JSON.stringify({
                    type: sectionConfig.type,
                    name: sectionConfig.name,
                    timestamp: Date.now()
                }));

                if (!triggeredSections.has(sectionConfig.type) && !isChatOpen && nudgeCount < MAX_NUDGES) {
                    sectionTimers[sectionConfig.type] = setTimeout(() => {
                        triggerSectionNudge(sectionConfig.type);
                    }, sectionConfig.delay);
                }
            } else {
                if (sectionTimers[sectionConfig.type]) {
                    clearTimeout(sectionTimers[sectionConfig.type]);
                    delete sectionTimers[sectionConfig.type];
                }
            }
        });
    }, { threshold: 0.25 }); 

    sections.forEach(s => {
        const el = document.getElementById(s.id);
        if (el) observer.observe(el);
    });
}

function triggerSectionNudge(type) {
    if (nudgeCount >= MAX_NUDGES || triggeredSections.has(type) || isChatOpen) return;

    triggeredSections.add(type);
    nudgeCount++;
    
    if (type === 'contact') {
        triggerNotification("Can I help?", "I see you're at the contact section. Hesitating? Click me and I'll help you fill the form! ✍️");
        
        setTimeout(() => {
             const nudgeCard = {
                title: "Contact Assistant",
                tech: "Form Helper",
                // TODO: Replace with your own image
                image: "https://via.placeholder.com/300x150?text=Contact+Helper",
                actionType: 'fillForm', 
                targetId: 'general'
            };
            addMessage("I see you're at the Contact section but haven't written anything. I can pre-fill a quick message for you.", 'bot', nudgeCard);
        }, 100);

    } else if (type === 'projects') {
        triggerNotification("Looking for ideas?", "I can help you choose a project. Click me! 🎨");
        
        setTimeout(() => {
            const projectHTML = `
                Can I help you pick a project? I recommend:
                <div class="work-card" data-project="example1" onclick="window.openProjectModal('example1')">
                    <!-- TODO: Replace placeholder -->
                    <img src="https://via.placeholder.com/300x150?text=Project+Example" class="wc-img" alt="Example Project">
                    <div class="wc-overlay"><span class="wc-cat">Branding</span><h3 class="wc-title">Example Brand</h3></div>
                </div>
            `;
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message bot';
            msgDiv.innerHTML = projectHTML + `<span class="msg-time">${getCurrentTime()}</span>`;
            messagesContainer.insertBefore(msgDiv, typingIndicator);
            scrollToBottom();
        }, 100);
    }
}

function getTimeBasedGreeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Good morning ☕";
    if (hour >= 12 && hour < 18) return "Good afternoon ☀️";
    return "Good evening 🌙";
}

function initHighlightToAsk() {
    highlightTooltip = document.createElement('div');
    highlightTooltip.id = 'azzis-highlight-tooltip';
    highlightTooltip.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
        Ask Assistant
    `;
    document.body.appendChild(highlightTooltip);

    document.addEventListener('mouseup', (e) => {
        if (chatWindow.contains(e.target) || highlightTooltip.contains(e.target) || launcher.contains(e.target)) return;

        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText.length > 3) { 
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            
            highlightTooltip.style.top = `${rect.top + window.scrollY - 40}px`;
            highlightTooltip.style.left = `${rect.left + (rect.width / 2) - 60}px`;
            highlightTooltip.style.display = 'flex';
            
            highlightTooltip.onclick = () => {
                if (!isChatOpen) toggleChat();
                const question = `Can you tell me more about: "${selectedText}"?`;
                inputField.value = question;
                sendChatMessage();
                highlightTooltip.style.display = 'none';
                selection.removeAllRanges();
            };
        } else {
            highlightTooltip.style.display = 'none';
        }
    });

    document.addEventListener('mousedown', (e) => {
        if (!highlightTooltip.contains(e.target)) {
            highlightTooltip.style.display = 'none';
        }
    });
}

function initExitIntent() {
    document.addEventListener('mouseleave', (e) => {
        if (e.clientY <= 0 && !hasExitIntentTriggered && !isChatOpen) {
            hasExitIntentTriggered = true;
            lastExitIntentTime = Date.now(); 
            toggleChat();
            setTimeout(() => {
                addMessage("Wait! Before you leave, would you like to download my CV or see the portfolio quickly?", 'bot');
            }, 600);
        }
    });
}

async function checkHardwareStatus() {
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            if (battery.level < 0.2 && !battery.charging) {
                setTimeout(() => {
                   if(isChatOpen) addMessage("I see your battery is low. I'll keep it brief! ⚡", 'bot');
                }, 1000);
            }
        } catch (e) { console.log(e); }
    }
}

function toggleChat() {
    isChatOpen = !isChatOpen;
    if (isChatOpen) {
        launcher.classList.remove('visible'); 
        launcher.classList.add('hidden-right'); 
        if(notification) notification.classList.remove('active'); 
        chatWindow.classList.add('open');
        setTimeout(() => inputField.focus(), 300);
        scrollToBottom();

        if (!hasNotifiedOpen) {
            notifyTelegram('CHAT_OPEN');
            hasNotifiedOpen = true; 
        }

    } else {
        chatWindow.classList.remove('open');
        setTimeout(() => {
            launcher.classList.remove('hidden-right');
            launcher.classList.add('visible');
        }, 300);
    }
}

function resetChat() {
    localStorage.removeItem('bot_history');
    localStorage.removeItem('bot_interaction_count');
    interactionCount = 0;
    pendingNavigation = null;
    currentSentiment = 'neutral';
    hasRated = false;
    ratingVisible = false;

    chatWindow.classList.remove('urgent-mode');
    chatWindow.classList.remove('matrix-mode'); 
    isMatrixMode = false;

    const savedContext = JSON.parse(localStorage.getItem('bot_last_context'));
    let welcomeMsg = '';
    let hasContext = false;

    if (savedContext) {
        const hoursPassed = (Date.now() - savedContext.timestamp) / (1000 * 60 * 60);
        if (hoursPassed < MEMORY_EXPIRY_HOURS) {
            hasContext = true;
            const greeting = getTimeBasedGreeting();
            welcomeMsg = `
                <div class="message bot">
                    ${greeting}<br>Welcome back! 👋<br>
                    Last time you were looking at the <b>${savedContext.name}</b> section. Want to continue there?
                    <span class="msg-time">${getCurrentTime()}</span>
                </div>
            `;
            pendingNavigation = { 
                selector: `#${savedContext.type === 'contact' ? 'contact' : savedContext.type}`, 
                msg: "Great! Taking you there immediately." 
            };
        }
    }

    if (!hasContext) {
        const greeting = getTimeBasedGreeting();
        welcomeMsg = `
            <div class="message bot">
                ${greeting}<br>I am your AI Assistant.<br>How can I help you?
                <span class="msg-time">${getCurrentTime()}</span>
            </div>
        `;
    }

    messagesContainer.innerHTML = welcomeMsg;
    messagesContainer.appendChild(typingIndicator);
    
    renderQuickReplies();
    showTyping(false);
    
    if(window.innerWidth > 768) inputField.focus();
}

function handleInput(event) {
    if (event.key === 'Enter') {
        if (slashMenu && slashMenu.style.display === 'flex') return;
        sendChatMessage();
    }
}

function analyzeSentiment(text) {
    const lowerText = text.toLowerCase();
    
    const urgentPatterns = [
        /(!!+)/,           
        /urgent/,
        /help/,
        /error/,
        /problem/,
        /broken/,
        /now/
    ];

    const upperCaseCount = text.replace(/[^A-Z]/g, "").length;
    const totalLength = text.length;
    const isYelling = totalLength > 10 && (upperCaseCount / totalLength) > 0.6;

    const isUrgent = urgentPatterns.some(pattern => pattern.test(lowerText)) || isYelling;

    if (isUrgent) {
        return 'urgent';
    }
    return 'neutral';
}

function showRatingRequest() {
    if (hasRated || ratingVisible) return;
    
    ratingVisible = true;
    
    const ratingHTML = `
        <div class="rating-container">
            <div class="rating-text">How was this conversation?</div>
            <div class="star-group">
                <span class="star-icon" onclick="handleRating(1)">★</span>
                <span class="star-icon" onclick="handleRating(2)">★</span>
                <span class="star-icon" onclick="handleRating(3)">★</span>
                <span class="star-icon" onclick="handleRating(4)">★</span>
                <span class="star-icon" onclick="handleRating(5)">★</span>
            </div>
        </div>
    `;

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message bot bot-card';
    msgDiv.innerHTML = ratingHTML + `<span class="msg-time">${getCurrentTime()}</span>`;
    
    messagesContainer.insertBefore(msgDiv, typingIndicator);
    scrollToBottom();
}

window.handleRating = function(score) {
    if (hasRated) return;
    hasRated = true;

    const starGroup = document.querySelector('.star-group');
    if (starGroup) starGroup.style.pointerEvents = 'none';

    const stars = document.querySelectorAll('.star-icon');
    stars.forEach((star, index) => {
        if (index < score) star.classList.add('selected');
    });

    notifyTelegram('RATING', { stars: score, message: "A user rated you " + score + " stars." });

    let reply = "";
    if (score === 5) reply = "Wow, 5 stars! ⭐ Thank you so much! Glad I could help.";
    else if (score >= 4) reply = "Thank you! I strive to be helpful.";
    else if (score >= 2) reply = "Thanks for the feedback. I'm constantly learning.";
    else reply = "Sorry I couldn't do better. I'll work on it! 😔";

    setTimeout(() => {
        addMessage(reply, 'bot');
    }, 800);
}

async function sendChatMessage() {
    const text = inputField.value.trim();
    if (!text) return;
    
    removeQuickReplies();

    addMessage(text, 'user');
    
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    
    inputField.value = '';
    showTyping(true);
    
    interactionCount++;
    const lowerText = text.toLowerCase();

    const isGoodbye = (lowerText.includes('bye') && lowerText.length < 5) || 
                      lowerText.includes('goodbye') || 
                      lowerText.includes('see ya') ||
                      lowerText.includes('thank you');

    if (interactionCount >= 5) unlockAchievement('CHATTY');

    // Example logic for showing a specific project via keyword
    if (lowerText.includes('example') || lowerText.includes('latest project')) {
        setTimeout(() => {
            showTyping(false);
            const projectHTML = `
                <div class="work-card" data-project="example1" onclick="window.openProjectModal('example1')">
                    <!-- TODO: Replace placeholder -->
                    <img src="https://via.placeholder.com/300x150?text=Latest+Project" class="wc-img" alt="Latest Project">
                    <div class="wc-overlay"><span class="wc-cat">Design</span><h3 class="wc-title">Latest Project</h3></div>
                </div>
            `;
            const msgDiv = document.createElement('div');
            msgDiv.className = 'message bot';
            msgDiv.innerHTML = "My latest project is here:" + projectHTML + `<span class="msg-time">${getCurrentTime()}</span>`;
            messagesContainer.insertBefore(msgDiv, typingIndicator);
            speakText("My latest project is here.");
            scrollToBottom();
            enterFocusMode();
        }, 1500);
        return;
    }

    const sentiment = analyzeSentiment(text);
    if (sentiment === 'urgent' && currentSentiment !== 'urgent') {
        currentSentiment = 'urgent';
        chatWindow.classList.add('urgent-mode');
        setTimeout(() => {
             addMessage("**I hear you.** I see this is urgent. Let's get to the point.", 'bot');
        }, 500);
    } else if (sentiment === 'neutral' && currentSentiment === 'urgent') {
        currentSentiment = 'neutral';
        chatWindow.classList.remove('urgent-mode');
    }

    if (pendingNavigation && (lowerText.includes('yes') || lowerText.includes('sure') || lowerText.includes('ok'))) {
        const element = document.querySelector(pendingNavigation.selector);
        if (element) {
            const blockPos = pendingNavigation.selector === '.fw-section' ? 'center' : 'start';
            element.scrollIntoView({ behavior: 'smooth', block: blockPos });
            
            element.classList.add('azzis-focus-highlight');
            setTimeout(() => element.classList.remove('azzis-focus-highlight'), 3500);
            
            addMessage(pendingNavigation.msg, 'bot');
        } else {
            addMessage("I couldn't find that section.", 'bot');
        }
        pendingNavigation = null; 
        showTyping(false);
        
        return;
    } else if (pendingNavigation) {
        pendingNavigation = null; 
    }

    if (handleAccessibilityCommand(lowerText)) {
        showTyping(false);
        return; 
    }

    if (handleNavigationCommand(lowerText)) {
        showTyping(false);
        return;
    }

    const isYesToExit = hasExitIntentTriggered && (Date.now() - lastExitIntentTime < 60000) && (lowerText.includes('yes') || lowerText.includes('sure'));
    const isExplicitCV = lowerText.includes('cv') || lowerText.includes('resume') || lowerText.includes('pdf') || lowerText.includes('download');

    if (isYesToExit || isExplicitCV) {
        setTimeout(() => {
            showTyping(false);
            const cvCard = {
                title: "Curriculum Vitae",
                tech: "PDF Document",
                image: "https://via.placeholder.com/300x150?text=Resume+PDF", // TODO: Replace placeholder
                actionType: 'downloadCV'
            };
            addMessage("Excellent! You can download my CV right here:", 'bot', cvCard);
            enterFocusMode();
        }, 1000);
        return;
    }

    try {
        const response = await fetch(CONFIG.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: text,
                sentiment: currentSentiment 
            })
        });
        const data = await response.json();
        showTyping(false);
        addMessage(data.reply, 'bot', data.card || null);

        if (interactionCount === 3 && !hasAskedForLead) {
            hasAskedForLead = true;
            setTimeout(() => {
                if(isChatOpen) {
                    const leadCard = {
                        title: "Let's keep in touch",
                        tech: "Collaboration",
                        image: "https://via.placeholder.com/300x150?text=Chat+Icon", // TODO: Replace placeholder
                        actionType: 'fillForm', 
                        targetId: 'general'
                    };
                    addMessage("This is going great! Want to leave your email so I can contact you with a proposal?", 'bot', leadCard);
                }
            }, 3000); 
        }
        
        if (isGoodbye && interactionCount > 2 && !hasRated) {
            setTimeout(() => {
                showRatingRequest();
            }, 2000); 
        }

    } catch (error) {
        console.error("Bot Error:", error);
        showTyping(false);
        addMessage("I'm sorry, I encountered a connection error. Please try again.", 'bot');
    }
}

function handleNavigationCommand(text) {
    // Keywords to trigger scrolling to specific sections
    const navMap = [
        { keywords: ['values', 'principles', 'motto'], selector: '.fw-section', msg: "These are my core values." },
        { keywords: ['services', 'offer', 'what do you do'], selector: '#services', msg: "Here are the available services." },
        { keywords: ['portfolio', 'work', 'projects'], selector: '#projects', msg: "Here is the projects section." },
        { keywords: ['review', 'feedback', 'testimonial'], selector: '#reviews', msg: "See what clients say about me." },
        { keywords: ['contact', 'mail', 'write', 'message', 'email'], selector: '#contact', msg: "You can contact me anytime here." },
        { keywords: ['home', 'start', 'top', 'hero'], selector: '#home', msg: "Back to the top!" }
    ];

    for (let item of navMap) {
        if (item.keywords.some(k => text.includes(k))) {
            if (item.selector === '#contact') {
                const element = document.querySelector(item.selector);
                if (element) {
                     element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                     element.classList.add('azzis-focus-highlight');
                     setTimeout(() => element.classList.remove('azzis-focus-highlight'), 3500);
                }
                addMessage(item.msg, 'bot');
            } else {
                pendingNavigation = { selector: item.selector, msg: "I've navigated you to that section. 🚀" };
                addMessage(`${item.msg}<br><br><b>Do you want me to take you there?</b>`, 'bot');
            }
            return true; 
        }
    }
    return false; 
}

function handleAccessibilityCommand(text) {
    if (text.includes('cant see') || text.includes('too small') || text.includes('larger') || text.includes('font')) {
        document.body.style.fontSize = "120%"; 
        addMessage("I increased the text size for you. Is that better?", 'bot');
        return true;
    }
    return false;
}

function addMessage(text, sender, cardData = null) {
    const msgDiv = document.createElement('div');
    if (sender === 'bot') {
        const lowerT = text ? text.toLowerCase() : "";
        
        // 1. Warning / Alert
        if (text.includes('⚠️') || text.includes('Attention:') || text.includes('Note:') || currentSentiment === 'urgent') {
            msgDiv.classList.add('msg-warning');
        }
        // 2. Idea Highlight
        else if (text.includes('💡') || text.includes('Tip:') || text.includes('Idea:')) {
            msgDiv.classList.add('msg-idea');
        }
        // 3. Quotes 
        else if (text.startsWith('> ') || (text.includes('"') && text.length < 100)) {
            msgDiv.classList.add('msg-quote');
        }
        
        if (currentSentiment === 'urgent') {
            msgDiv.classList.add('urgent');
        }
    }

    let shouldTriggerFocus = false;
    if (sender === 'bot') {
        if (cardData) shouldTriggerFocus = true;
        if (text && text.length > 150) shouldTriggerFocus = true;
    }

    if (cardData && sender === 'bot') {
        msgDiv.classList.add('message', 'bot-card');
        let actionButtonHtml = '';
        
        if (cardData.actionType === 'modal') {
            actionButtonHtml = `<button onclick="window.openProjectModal('${cardData.targetId}')" class="azzis-card-btn">Open Project ↗</button>`;
        } else if (cardData.actionType === 'fillForm') {
            actionButtonHtml = `<button onclick="window.prefillContactForm('${cardData.targetId}')" class="azzis-card-btn">Fill Form ✍️</button>`;
        } else if (cardData.actionType === 'downloadCV') {
            actionButtonHtml = `<button onclick="window.downloadCV()" class="azzis-card-btn">Download PDF 📥</button>`;
        } else {
            actionButtonHtml = `<a href="${cardData.link}" target="_blank" class="azzis-card-btn">View Details</a>`;
        }
        
        const cardHTML = `
            <div class="azzis-card">
                <img src="${cardData.image}" class="azzis-card-img" alt="${cardData.title}">
                <div class="azzis-card-body">
                    <div class="azzis-card-title">${cardData.title}</div>
                    <div class="azzis-card-tech">${cardData.tech}</div>
                    ${actionButtonHtml}
                </div>
            </div>
            <span class="msg-time">${getCurrentTime()}</span>
        `;
        msgDiv.innerHTML = cardHTML;
        
        if (text) {
            const textDiv = document.createElement('div');
            textDiv.classList.add('message', 'bot');
            
            if (currentSentiment === 'urgent') textDiv.classList.add('urgent');
            if (text.includes('💡')) textDiv.classList.add('msg-idea');
            
            textDiv.innerHTML = formatText(text) + `<span class="msg-time">${getCurrentTime()}</span>`;
            messagesContainer.insertBefore(textDiv, typingIndicator);

            speakText(text);
        }

    } else {
        msgDiv.classList.add('message', sender);
        
        let formattedText = formatText(text);
        const timeString = getCurrentTime();
        
        msgDiv.innerHTML = formattedText + `<span class="msg-time">${timeString}</span>`;

        if (sender === 'bot') {
            speakText(text);
        }
    }
    
    messagesContainer.insertBefore(msgDiv, typingIndicator);
    
    if(typeof hljs !== 'undefined') {
        msgDiv.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
    }

    scrollToBottom();

    if(shouldTriggerFocus) {
        enterFocusMode();
    }
}

function formatText(text) {
    if (typeof marked !== 'undefined') {
        return marked.parse(text);
    } else {
        let formatted = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
        return formatted.replace(/\n/g, '<br>');
    }
}

function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function showTyping(show) {
    if (show) {
        typingIndicator.style.display = 'flex';
        messagesContainer.appendChild(typingIndicator);
    } else {
        typingIndicator.style.display = 'none';
    }
    scrollToBottom();
}
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}
