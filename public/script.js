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
let longPressTimer = null;
let isLongPress = false;

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
        console.log("Login response:", data);
        if (data.ok) {
            localStorage.token = data.token;
            localStorage.uid = data.uid;
            currentUser = { uid: data.uid, email: data.email };
            balance = data.balance || 0;
            enterMainApp();
            showToast("تم الدخول بنجاح!");
        } else {
            showToast(data.error || "فشل الدخول");
        }
    } catch (e) {
        console.error("Login error:", e);
        showToast("خطأ في الاتصال بالخادم");
    }
}

async function handleRegister() {
    const email = document.getElementById('reg-email').value.trim();
    const pass = document.getElementById('reg-pass').value;
    const conf = document.getElementById('reg-pass-conf').value;

    if (!email || !pass || !conf) return showToast("أكمل جميع الحقول");
    if (pass !== conf) return showToast("كلمات المرور غير متطابقة");
    if (pass.length < 6) return showToast("كلمة المرور قصيرة جداً (6 أحرف على الأقل)");

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pass })
        });
        const data = await res.json();
        console.log("Register response:", data);
        if (data.ok) {
            showToast("تم التسجيل! الآن سجل دخول");
            setTimeout(() => {
                showAuth('login');
                document.getElementById('login-email').value = email;
                document.getElementById('login-pass').value = '';
            }, 500);
        } else {
            showToast(data.error || "فشل التسجيل");
        }
    } catch (e) {
        console.error("Register error:", e);
        showToast("خطأ في الاتصال بالخادم");
    }
}

async function handleLogout() {
    if (confirm("هل تريد تسجيل الخروج؟")) {
        localStorage.clear();
        currentUser = null;
        location.reload();
    }
}

async function handleGoogleAuth() {
    try {
        showToast("جاري تسجيل الدخول عبر Google...");
        const result = await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
        const user = result.user;
        const token = await user.getIdToken();
        const response = await fetch('/api/firebase-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firebaseToken: token, email: user.email, uid: user.uid, displayName: user.displayName })
        });
        const data = await response.json();
        if (data.ok) {
            localStorage.token = data.token;
            localStorage.uid = data.uid;
            currentUser = { uid: data.uid, email: user.email };
            balance = data.balance || 0;
            enterMainApp();
            showToast("تم الدخول بنجاح!");
        } else {
            showToast(data.error || "فشل التحقق");
        }
    } catch (e) {
        console.error("Google Auth error:", e);
        showToast("خطأ في Google Auth: " + e.message);
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
    if (key0) {
        let touchStartTime = 0;
        key0.addEventListener('touchstart', () => { touchStartTime = Date.now(); });
        key0.addEventListener('touchend', () => {
            const touchDuration = Date.now() - touchStartTime;
            if (touchDuration >= 500) {
                dialNumber += '+';
                updateDialDisplay();
            } else {
                dial('0');
            }
        });
        key0.addEventListener('mousedown', () => { touchStartTime = Date.now(); });
        key0.addEventListener('mouseup', () => {
            const touchDuration = Date.now() - touchStartTime;
            if (touchDuration >= 500) {
                dialNumber += '+';
                updateDialDisplay();
            }
        });
    }
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

// =============== PHONE CONTACTS (Capacitor) ===============

async function requestContactsPermission() {
    try {
        // Check if Capacitor Contacts is available
        if (typeof window.CapacitorContacts !== 'undefined') {
            const contacts = await window.CapacitorContacts.getContacts();
            displayNativeContacts(contacts.contacts || []);
        } else {
            showToast("Capacitor Contacts not available on this platform");
        }
    } catch (e) {
        console.error("Contacts error:", e);
        showToast("خطأ في الوصول لجهات الاتصال: " + e.message);
    }
}

function displayNativeContacts(contacts) {
    const list = document.getElementById('contacts-list');
    if (!list) return;

    if (!contacts || contacts.length === 0) {
        list.innerHTML = '<p style="text-align:center;padding:20px;color:#999;">لا توجد جهات اتصال</p>';
        return;
    }

    list.innerHTML = contacts.slice(0, 50).map((contact, i) => {
        const name = contact.name || "Unknown";
        const phone = contact.phones?.[0]?.number || "---";
        return `
            <div class="list-item" onclick="setDial('${phone}')">
                <div class="item-info">
                    <div class="avatar">${name.charAt(0).toUpperCase()}</div>
                    <div class="item-details">
                        <h4>${name}</h4>
                        <p>${phone}</p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
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
            loadRecordings();
            return;
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

async function loadRecordings() {
    try {
        const res = await fetch('/api/recordings', {
            headers: { Authorization: `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        const list = document.getElementById('logs-list');
        if (!list) return;

        if (!data.ok || !data.recordings || data.recordings.length === 0) {
            list.innerHTML = '<p style="text-align:center;padding:20px;color:#999;">لا توجد تسجيلات</p>';
            return;
        }

        list.innerHTML = data.recordings.map(rec => `
            <div style="padding:12px;border-bottom:1px solid #eee;">
                <div><strong>Call: ${rec.callSid.substring(0, 10)}...</strong></div>
                <div style="font-size:0.85rem;color:#888;">
                    ⏱️ ${rec.duration} ثانية • ${new Date(rec.dateCreated).toLocaleString('ar-SA')}
                </div>
                <audio style="width:100%; margin-top:8px;" controls>
                    <source src="${rec.url}" type="audio/wav">
                </audio>
            </div>
        `).join('');
    } catch (e) {
        console.error("Load recordings error:", e);
        showToast("خطأ في تحميل التسجيلات");
    }
}

// =============== MESSAGES ===============

function openNewMessageUI() {
    const modal = document.getElementById('modal-new-msg');
    if (modal) modal.style.display = 'grid';
}

function switchMsgTab(tab) {
    const smsPanel = document.getElementById('msg-sms');
    const notifPanel = document.getElementById('msg-notifications');

    if (tab === 'sms') {
        if (smsPanel) smsPanel.style.display = 'block';
        if (notifPanel) notifPanel.style.display = 'none';
        loadSMSMessages();
    } else {
        if (smsPanel) smsPanel.style.display = 'none';
        if (notifPanel) notifPanel.style.display = 'block';
    }
}

async function loadSMSMessages() {
    try {
        const res = await fetch('/api/sms/list', {
            headers: { Authorization: `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        const list = document.getElementById('messages-list');
        if (!list) return;

        if (!data.ok || !data.messages || data.messages.length === 0) {
            list.innerHTML = '<p style="text-align:center;padding:20px;color:#999;">لا توجد رسائل</p>';
            return;
        }

        list.innerHTML = data.messages.map(msg => `
            <div style="padding:12px;border-bottom:1px solid #eee;">
                <div><strong>${msg.toNumber}</strong></div>
                <div style="font-size:0.9rem; color:#333; margin:5px 0;">${msg.message}</div>
                <div style="font-size:0.8rem;color:#888;">
                    ${msg.direction === 'outgoing' ? '📤' : '📥'} • ${new Date(msg.timestamp).toLocaleString('ar-SA')}
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error("Load SMS error:", e);
    }
}

async function sendNewMessage() {
    const to = document.getElementById('new-msg-number')?.value || '';
    const text = document.getElementById('new-msg-text')?.value || '';

    if (!to || !text) return showToast("أكمل الحقول");

    try {
        const res = await fetch('/api/sms/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.token}`
            },
            body: JSON.stringify({ to, message: text })
        });
        const data = await res.json();
        if (data.ok) {
            showToast("تم إرسال الرسالة!");
            closeSubPage('modal-new-msg');
            document.getElementById('new-msg-number').value = '';
            document.getElementById('new-msg-text').value = '';
            loadSMSMessages();
        } else {
            showToast(data.error || "فشل الإرسال");
        }
    } catch (e) {
        console.error("Send SMS error:", e);
        showToast("خطأ في الإرسال");
    }
}

// =============== ACCOUNT PAGE ===============

async function loadAccountInfo() {
    try {
        const res = await fetch('/api/user-info', {
            headers: { Authorization: `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        if (data.ok) {
            const numEl = document.getElementById('account-us-number-display');
            if (numEl) numEl.innerText = data.virtualNumber;
        }
    } catch (e) {
        console.error("Load account info error:", e);
    }
}

function openSubPage(pageId) {
    const page = document.getElementById(pageId);
    if (!page) return;
    page.style.display = 'flex';
    
    // Load account info when opening account page
    if (pageId === 'page-account') {
        loadAccountInfo();
    }
}

// =============== PAYMENT GATEWAY ===============

async function processPayment(amount) {
    try {
        const res = await fetch('/api/topup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.token}`
            },
            body: JSON.stringify({ amount })
        });
        const data = await res.json();
        if (data.ok) {
            balance = data.newBalance;
            document.getElementById('header-balance').innerText = balance.toFixed(2);
            showToast(`تم الشحن بنجاح! الرصيد الجديد: $${balance.toFixed(2)}`);
            closeSubPage('page-topup');
            return true;
        } else {
            showToast(data.error || "فشل الشحن");
            return false;
        }
    } catch (e) {
        console.error("Payment error:", e);
        showToast("خطأ في معالجة الدفع");
        return false;
    }
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

