// ================================================
// Private Dialer - Brain Logic (العقل البرمجي)
// ================================================

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

const db = firebase ? firebase.database() : null;
const auth = firebase ? firebase.auth() : null;

let currentUser = null;
let balance = 0;
let dialNumber = "";
let activeCallSid = null;
let callTimer = null;
let callSeconds = 0;
let twilioDevice = null;
let activeCall = null;
let selectedContact = null;
let activeTransferPrice = 0.99;
let aliasEnabled = false;

// =============== AUTH FUNCTIONS ===============

function showAuth(screen) {
    document.getElementById('auth-start').style.display = 'none';
    document.getElementById('auth-welcome').style.display = 'none';
    document.getElementById('auth-login').style.display = 'none';
    document.getElementById('auth-register').style.display = 'none';

    if (screen === 'start') document.getElementById('auth-start').style.display = 'flex';
    else if (screen === 'welcome') document.getElementById('auth-welcome').style.display = 'flex';
    else if (screen === 'login') document.getElementById('auth-login').style.display = 'flex';
    else if (screen === 'register') document.getElementById('auth-register').style.display = 'flex';
}

async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    if (!email || !pass) return showToast("أدخل البريد وكلمة المرور");

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass })
        });
        const data = await res.json();
        if (data.ok) {
            localStorage.token = data.token;
            localStorage.uid = data.uid;
            currentUser = { uid: data.uid };
            balance = data.balance || 0;
            enterMainApp();
            showToast("تم الدخول بنجاح");
        } else {
            showToast(data.error || "فشل الدخول");
        }
    } catch (e) {
        showToast("خطأ في الاتصال بالخادم");
    }
}

async function handleRegister() {
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value;
    const conf = document.getElementById('reg-pass-conf').value;

    if (!email || !pass || !conf) return showToast("أكمل جميع الحقول");
    if (pass !== conf) return showToast("كلمات المرور غير متطابقة");

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass })
        });
        const data = await res.json();
        if (data.ok) {
            showToast("تم التسجيل! الآن سجل دخول");
            showAuth('login');
            document.getElementById('login-email').value = email;
        } else {
            showToast(data.error || "فشل التسجيل");
        }
    } catch (e) {
        showToast("خطأ في الاتصال");
    }
}

async function handleLogout() {
    if (confirm("هل تريد تسجيل الخروج؟")) {
        localStorage.clear();
        currentUser = null;
        location.reload();
    }
}

function enterMainApp() {
    document.querySelectorAll('.auth-container').forEach(el => el.style.display = 'none');
    document.getElementById('main-interface').classList.add('visible');
    loadUserData();
    initTwilio();
}

// =============== USER DATA ===============

async function loadUserData() {
    if (!localStorage.token) return;
    try {
        const res = await fetch('/api/user', {
            headers: { Authorization: `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        if (data.ok) {
            balance = data.user.balance;
            document.getElementById('header-balance').innerText = balance.toFixed(2);
        }
    } catch (e) {
        console.error(e);
    }
}

// =============== DIALER FUNCTIONS ===============

function dial(digit) {
    dialNumber += digit;
    updateDialDisplay();
}

function updateDialDisplay() {
    const el = document.getElementById('dial-number');
    if (el) el.innerText = dialNumber;
}

function deleteDigit() {
    dialNumber = dialNumber.slice(0, -1);
    updateDialDisplay();
}

document.addEventListener('DOMContentLoaded', () => {
    const delBtn = document.getElementById('btn-delete');
    if (delBtn) delBtn.addEventListener('click', deleteDigit);
    const key0 = document.getElementById('key-0');
    if (key0) key0.addEventListener('click', () => dial('0'));
});

function toggleAlias() {
    const container = document.getElementById('alias-input-container');
    if (container) container.classList.toggle('open');
}

// =============== TWILIO CALL ===============

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
        twilioDevice.on('connect', (conn) => {
            activeCall = conn;
            callConnected();
        });
        twilioDevice.on('disconnect', () => {
            callDisconnected();
        });

        await twilioDevice.register();
    } catch (e) {
        console.error('[Twilio]', e);
    }
}

async function initiateRealCall() {
    if (!dialNumber) return showToast("أدخل رقماً");

    const displayNum = dialNumber;
    showCallOverlay(displayNum);

    // Try Twilio first
    if (twilioDevice) {
        try {
            activeCall = await twilioDevice.connect({ params: { To: dialNumber } });
            return;
        } catch (e) {
            console.error('[Twilio]', e);
        }
    }

    // Fallback to REST API
    try {
        const res = await fetch('/api/call', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.token}`
            },
            body: JSON.stringify({ to: dialNumber })
        });
        const data = await res.json();
        if (data.ok) {
            setTimeout(() => callConnected(), 3000);
        } else {
            showToast(data.error || "فشل الاتصال");
            hideCallOverlay();
        }
    } catch (e) {
        showToast("خطأ في الاتصال");
        hideCallOverlay();
    }
}

function callConnected() {
    callSeconds = 0;
    clearInterval(callTimer);
    callTimer = setInterval(() => {
        callSeconds++;
        const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
        const s = String(callSeconds % 60).padStart(2, '0');
        const el = document.getElementById('call-timer');
        if (el) el.innerText = `${m}:${s}`;
    }, 1000);
}

function hangupCall() {
    if (activeCall) {
        try {
            activeCall.disconnect();
        } catch (e) {}
        activeCall = null;
    }
    clearInterval(callTimer);
    hideCallOverlay();
    dialNumber = "";
    updateDialDisplay();
    loadUserData();
}

function showCallOverlay(num) {
    const overlay = document.getElementById('call-overlay');
    if (!overlay) return;
    
    const numEl = overlay.querySelector('.call-number') || overlay.querySelector('h2');
    if (numEl) numEl.innerText = num;
    
    overlay.style.display = 'grid';
}

function hideCallOverlay() {
    const overlay = document.getElementById('call-overlay');
    if (overlay) overlay.style.display = 'none';
}

// =============== DTMF TONES ===============

function sendDtmf(digit) {
    if (activeCall) {
        try {
            activeCall.sendDigits(digit);
        } catch (e) {
            console.error('DTMF error:', e);
        }
    }
}

// =============== CONTACTS ===============

function openAddContact() {
    const modal = document.getElementById('modal-add-contact');
    if (modal) modal.style.display = 'grid';
}

function saveNewContact() {
    const name = document.getElementById('new-contact-name')?.value || '';
    const num = document.getElementById('new-contact-number')?.value || '';
    if (!name || !num) return showToast("أكمل الحقول");

    if (currentUser && db) {
        db.ref('users/' + currentUser.uid + '/contacts').push({
            name: name,
            number: num,
            favorite: false,
            date: Date.now()
        });
        showToast("تم حفظ جهة الاتصال");
        closeSubPage('modal-add-contact');
    }
}

function renderContacts(type) {
    if (!currentUser || !db) return;

    const list = document.getElementById('contacts-list');
    if (!list) return;

    db.ref('users/' + currentUser.uid + '/contacts').once('value', snap => {
        const data = snap.val();
        if (!data) {
            list.innerHTML = '<p style="text-align:center;padding:20px;color:#999;">لا توجد جهات اتصال</p>';
            return;
        }

        const contacts = Object.entries(data).map(([id, c]) => ({ id, ...c }));
        let filtered = contacts;

        if (type === 'fav') {
            filtered = contacts.filter(c => c.favorite);
        }

        list.innerHTML = filtered.map(c => `
            <div style="padding:12px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;">
                <div onclick="setDial('${c.number}')" style="flex:1;cursor:pointer;">
                    <div style="font-weight:bold;">${c.name}</div>
                    <div style="font-size:0.9rem;color:#888;">${c.number}</div>
                </div>
                <button style="background:none;border:none;cursor:pointer;font-size:1.2rem;" 
                    onclick="toggleFavorite('${c.id}', ${c.favorite || false})">
                    <i class="fas fa-heart" style="color:${c.favorite ? '#FF1493' : '#ccc'};"></i>
                </button>
            </div>
        `).join('');
    });
}

function setDial(number) {
    dialNumber = number;
    updateDialDisplay();
    nav('page-dialer', document.getElementById('nav-dialer'));
}

function toggleFavorite(id, current) {
    if (!currentUser || !db) return;
    db.ref('users/' + currentUser.uid + '/contacts/' + id + '/favorite').set(!current);
    renderContacts('all');
}

// =============== CALL LOGS ===============

function renderLogs(type) {
    if (!currentUser || !db) return;

    const list = document.getElementById('logs-list');
    if (!list) return;

    db.ref('users/' + currentUser.uid + '/logs').orderByChild('date').limitToLast(50).once('value', snap => {
        const data = snap.val();
        if (!data) {
            list.innerHTML = '<p style="text-align:center;padding:20px;color:#999;">لا يوجد سجل</p>';
            return;
        }

        const logs = Object.values(data).reverse();
        let filtered = logs;

        if (type === 'recordings') {
            filtered = logs.filter(l => l.recorded);
        }

        list.innerHTML = filtered.map(l => `
            <div style="padding:12px;border-bottom:1px solid #eee;">
                <div><strong>${l.to}</strong></div>
                <div style="font-size:0.85rem;color:#888;">
                    ${l.type === 'outgoing' ? '📤' : '📥'} • ${new Date(l.date).toLocaleString('ar-SA')}
                </div>
                <div style="color:#d32f2f;font-weight:bold;">-$${(l.cost || 0).toFixed(2)}</div>
            </div>
        `).join('');
    });
}

// =============== MESSAGES ===============

function openNewMessageUI() {
    const modal = document.getElementById('modal-new-msg');
    if (modal) modal.style.display = 'grid';
}

function switchMsgTab(tab) {
    document.querySelectorAll('.msg-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tab)?.classList.add('active');

    const smsPanel = document.getElementById('sms-messages');
    const notifPanel = document.getElementById('notifications');

    if (tab === 'sms') {
        if (smsPanel) smsPanel.style.display = 'block';
        if (notifPanel) notifPanel.style.display = 'none';
    } else {
        if (smsPanel) smsPanel.style.display = 'none';
        if (notifPanel) notifPanel.style.display = 'block';
    }
}

function sendNewMessage() {
    const to = document.getElementById('new-msg-number')?.value || '';
    const text = document.getElementById('new-msg-text')?.value || '';

    if (!to || !text) return showToast("أكمل الحقول");
    if (!currentUser || !db) return;

    db.ref('users/' + currentUser.uid + '/messages').push({
        number: to,
        text: text,
        type: 'sent',
        date: Date.now(),
        cost: 0.05
    });

    updateBalance(-0.05);
    showToast("تم إرسال الرسالة");
    closeSubPage('modal-new-msg');
}

function openChatInterface(num, name) {
    const header = document.getElementById('chat-header');
    if (header) header.innerText = name;
    document.getElementById('page-chat').style.display = 'block';
    selectedContact = { number: num, name: name };
}

function sendChatMessage() {
    const text = document.getElementById('chat-input')?.value || '';
    if (!text || !selectedContact) return;

    showToast("تم إرسال الرسالة");
    document.getElementById('chat-input').value = '';
}

// =============== PAYMENT ===============

function openSubPage(page) {
    document.getElementById(page).style.display = 'block';

    if (page === 'page-topup') {
        loadPayPalButton();
    }
}

function closeSubPage(page) {
    const el = document.getElementById(page);
    if (el) el.style.display = 'none';
}

function selectPrice(price, el) {
    activeTransferPrice = price;
    document.querySelectorAll('.price-btn').forEach(b => b.classList.remove('active'));
    if (el) el.classList.add('active');
}

function simulatePay() {
    updateBalance(activeTransferPrice);
    showToast("تم الشحن (محاكاة)");
    closeSubPage('page-topup');
}

function loadPayPalButton() {
    if (typeof paypal === 'undefined') return;

    const container = document.getElementById('paypal-button-container');
    if (!container) return;

    container.innerHTML = '';

    paypal.Buttons({
        createOrder: (data, actions) => {
            return actions.order.create({
                purchase_units: [{
                    amount: { value: activeTransferPrice.toString() }
                }]
            });
        },
        onApprove: (data, actions) => {
            return actions.order.capture().then(() => {
                updateBalance(activeTransferPrice);
                closeSubPage('page-topup');
                showToast("تم الشحن بنجاح");
            });
        },
        onError: () => {
            showToast("فشل الدفع");
        }
    }).render(container);
}

function processTransfer() {
    showToast("تم التحويل");
    closeSubPage('page-transfer');
}

// =============== ACCOUNT ===============

function checkRate() {
    const accountSection = document.getElementById('page-account');
    if (accountSection) {
        accountSection.style.display = 'block';
    }
    showToast("السعر: 0.05 دولار للدقيقة");
}

function toggleMute(btn) {
    if (btn) btn.classList.toggle('muted');
}

function toggleSpeaker(btn) {
    if (btn) btn.classList.toggle('speaker-on');
}

// =============== NAVIGATION ===============

function nav(pageId, btn) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId)?.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

// =============== UTILITY FUNCTIONS ===============

function showToast(msg) {
    const toast = document.getElementById('toast') || createToast();
    toast.innerText = msg;
    toast.style.display = 'block';
    toast.style.opacity = '1';

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            toast.style.display = 'none';
        }, 300);
    }, 3000);
}

function createToast() {
    const toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
        background: #333; color: white; padding: 12px 20px; border-radius: 25px;
        z-index: 9999; transition: opacity 0.3s; font-size: 0.9rem;
    `;
    document.body.appendChild(toast);
    return toast;
}

function updateBalance(amt) {
    balance += amt;
    if (currentUser && db) {
        db.ref('users/' + currentUser.uid + '/balance').set(balance);
    }
    document.getElementById('header-balance').innerText = balance.toFixed(2);
}

function logCall(to, type, cost) {
    if (currentUser && db) {
        db.ref('users/' + currentUser.uid + '/logs').push({
            to: to,
            type: type,
            date: Date.now(),
            cost: cost
        });
    }
}

// =============== INIT ===============

document.addEventListener('DOMContentLoaded', async () => {
    if (localStorage.token) {
        currentUser = { uid: localStorage.uid };
        enterMainApp();
    } else {
        showAuth('start');
    }
});
