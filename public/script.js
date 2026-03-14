// Firebase Config
const firebaseConfig = {
    apiKey: "GOOGLE_API_KEY",
    authDomain: "call-now-24582.firebaseapp.com",
    projectId: "call-now-24582",
    databaseURL: "https://call-now-24582-default-rtdb.firebaseio.com/"
};
if (typeof firebase !== 'undefined') {
    try { firebase.initializeApp(firebaseConfig); } catch(e) {}
}

let currentNumber = "";
let callSecs = 0;
let timerInterval = null;
let twilioDevice = null;
let activeCall = null;

// ── Splash ──────────────────────────────────────────
setTimeout(() => {
    const splash = document.getElementById('splash');
    splash.style.opacity = '0';
    setTimeout(() => {
        splash.style.display = 'none';
        if (!localStorage.token) {
            document.getElementById('login-screen').classList.remove('hidden');
        } else {
            document.getElementById('main-app').classList.remove('hidden');
            initApp();
        }
    }, 550);
}, 2400);

// ── Permissions ──────────────────────────────────────
async function requestPermissions() {
    // Microphone
    try { await navigator.mediaDevices.getUserMedia({ audio: true }); } catch(e) {}
    // Notifications
    try {
        if ('Notification' in window && Notification.permission === 'default')
            await Notification.requestPermission();
    } catch(e) {}
    // Contacts (Contact Picker API — only on supported browsers/Android)
    try {
        if ('contacts' in navigator && 'select' in navigator.contacts)
            console.log('Contacts API available');
    } catch(e) {}
}

// ── Twilio Voice SDK ─────────────────────────────────
async function initTwilio() {
    if (typeof Twilio === 'undefined') return;
    try {
        const res = await fetch('/api/token', {
            headers: { Authorization: `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        if (!data.ok) return;

        twilioDevice = new Twilio.Device(data.token, {
            codecPreferences: ['opus', 'pcmu'],
            enableIceRestart: true,
            logLevel: 0
        });

        twilioDevice.on('ready', () => console.log('[Twilio] Ready'));
        twilioDevice.on('registered', () => console.log('[Twilio] Registered'));
        twilioDevice.on('error', err => console.error('[Twilio] Error', err));
        twilioDevice.on('connect', conn => {
            activeCall = conn;
            setStatus('متصل');
            startTimer();
        });
        twilioDevice.on('disconnect', () => {
            setStatus('انتهت المكالمة');
            setTimeout(hangup, 1200);
        });

        await twilioDevice.register();
    } catch(e) { console.error('[Twilio] Init failed', e); }
}

async function initApp() {
    await requestPermissions();
    await refreshUser();
    await initTwilio();
}

// ── Auth ─────────────────────────────────────────────
async function handleAuth() {
    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-pass').value;
    if (!email || !pass) return alert('يرجى إدخال كافة البيانات');

    try {
        const res  = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass })
        });
        const data = await res.json();
        if (data.ok) {
            localStorage.token = data.token;
            localStorage.uid   = data.uid;
            location.reload();
        } else {
            alert(data.error || 'حدث خطأ');
        }
    } catch(e) { alert('تعذّر الاتصال بالخادم'); }
}

// ── Keypad ───────────────────────────────────────────
function kp(k) {
    if (currentNumber.length < 16) { currentNumber += k; render(); }
}
function delDigit() { currentNumber = currentNumber.slice(0, -1); render(); }
function render() {
    const el = document.getElementById('dial-display');
    if (el) el.textContent = currentNumber;
}

// ── Tabs ─────────────────────────────────────────────
function goTab(pageId, btn) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

// ── User data ────────────────────────────────────────
async function refreshUser() {
    if (!localStorage.token) return;
    try {
        const res  = await fetch('/api/user', {
            headers: { Authorization: `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        if (data.ok) {
            const bal = `$${data.user.balance.toFixed(2)}`;
            setText('bal-display', bal);
            setText('wallet-display', bal);
            setText('profile-num', `+1 (822) ${String(data.user.id).padStart(7, '0')}`);
        } else { doLogout(); }
    } catch(e) { console.error(e); }
}

// ── History ──────────────────────────────────────────
async function loadHistory() {
    try {
        const res  = await fetch('/api/history', {
            headers: { Authorization: `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        const wrap = document.getElementById('history-list');
        if (!data.ok || !wrap) return;
        wrap.innerHTML = data.history.length
            ? data.history.map(h => `
                <div class="list-card">
                    <div>
                        <h4>${h.toNumber}</h4>
                        <p>${new Date(h.timestamp).toLocaleString('ar-SA')}</p>
                    </div>
                    <div class="list-cost">-$${h.cost.toFixed(2)}</div>
                </div>`).join('')
            : '<p style="text-align:center;padding:40px;color:#aaa;">لا توجد مكالمات سابقة</p>';
    } catch(e) { console.error(e); }
}

// ── Call ─────────────────────────────────────────────
async function makeCall() {
    if (!currentNumber) return alert('أدخل الرقم أولاً');

    setText('overlay-num', currentNumber);
    setText('overlay-timer', '00:00');
    setStatus('جاري الاتصال...');
    document.getElementById('call-overlay').style.display = 'flex';

    // Try Twilio Voice SDK first
    if (twilioDevice) {
        try {
            activeCall = await twilioDevice.connect({ params: { To: currentNumber } });
            return;
        } catch(e) { console.error('[Twilio] connect error', e); }
    }

    // Fallback: REST API call
    try {
        const res  = await fetch('/api/call', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.token}`
            },
            body: JSON.stringify({ to: currentNumber })
        });
        const data = await res.json();
        if (data.ok) {
            setTimeout(() => { setStatus('متصل'); startTimer(); }, 3000);
        } else {
            alert(data.error || 'فشل الاتصال');
            hangup();
        }
    } catch(e) { alert('خطأ في الاتصال'); hangup(); }
}

function startTimer() {
    callSecs = 0;
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        callSecs++;
        const m = String(Math.floor(callSecs / 60)).padStart(2, '0');
        const s = String(callSecs % 60).padStart(2, '0');
        setText('overlay-timer', `${m}:${s}`);
    }, 1000);
}

function hangup() {
    if (activeCall) { try { activeCall.disconnect(); } catch(e) {} activeCall = null; }
    clearInterval(timerInterval);
    document.getElementById('call-overlay').style.display = 'none';
    currentNumber = "";
    render();
    refreshUser();
}

function setStatus(txt) { setText('overlay-status', txt); }
function doLogout() { localStorage.clear(); location.reload(); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.innerText = val; }
