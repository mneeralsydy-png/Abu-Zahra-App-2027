const { Capacitor, Plugins } = window.Capacitor || {};
const { Device, Geolocation, PushNotifications, GoogleAuth } = Plugins || {};

// Real Firebase Config
const firebaseConfig = { 
    apiKey: "GOOGLE_API_KEY", 
    authDomain: "call-now-24582.firebaseapp.com", 
    projectId: "call-now-24582", 
    databaseURL: "https://call-now-24582-default-rtdb.firebaseio.com/" 
};
firebase.initializeApp(firebaseConfig);

let currentNumber = "";
let callTimerInterval = null;
let callSeconds = 0;
let twilioDevice = null;
let activeCall = null;

// Splash screen handling
setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    splash.style.opacity = '0';
    setTimeout(() => {
        splash.style.display = 'none';
        if(!localStorage.token) {
            document.getElementById('login-screen').classList.remove('hidden');
        } else {
            document.getElementById('main-app').classList.remove('hidden');
            initApp();
        }
    }, 500);
}, 2500);

async function requestAllPermissions() {
    try {
        // Microphone
        await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Push Notifications
        if (Capacitor.isNativePlatform()) {
            await PushNotifications.requestPermissions();
        } else if ('Notification' in window) {
            await Notification.requestPermission();
        }
        
        // Geolocation
        if (Geolocation) await Geolocation.requestPermissions();
        
        // Contacts
        if ('contacts' in navigator && 'select' in navigator.contacts) {
            console.log("Contacts API supported");
        }
    } catch (e) { console.warn("Some permissions were denied", e); }
}

async function initTwilioDevice() {
    try {
        const res = await fetch('/api/token', {
            headers: { 'Authorization': `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        if(data.ok) {
            twilioDevice = new Twilio.Device(data.token, {
                codecPreferences: ['opus', 'pcmu'],
                fakeLocalAudio: false,
                enableIceRestart: true
            });

            twilioDevice.on('ready', () => console.log('Twilio Device Ready'));
            twilioDevice.on('error', (error) => console.error('Twilio Error:', error));
            twilioDevice.on('connect', (conn) => {
                activeCall = conn;
                document.getElementById('call-status').innerText = "متصل";
                startTimer();
            });
            twilioDevice.on('disconnect', () => hangup());
            
            await twilioDevice.register();
        }
    } catch (e) { console.error('Twilio Init Error:', e); }
}

async function initApp() {
    await requestAllPermissions();
    await initTwilioDevice();
    updateUserData();
}

async function handleAuth(type) {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-pass').value;
    if(!email || !password) return alert("يرجى إدخال كافة البيانات");

    try {
        const res = await fetch(`/api/${type}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if(data.ok) {
            localStorage.token = data.token;
            localStorage.uid = data.uid;
            location.reload();
        } else {
            alert(data.error);
        }
    } catch(e) { alert("خطأ في الاتصال بالخادم"); }
}

function dial(k) { 
    if(currentNumber.length < 15) {
        currentNumber += k; 
        updateDisplay(); 
    }
}
function deleteDigit() { currentNumber = currentNumber.slice(0, -1); updateDisplay(); }
function updateDisplay() { document.getElementById('dial-display').textContent = currentNumber; }

function switchTab(id, el) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    el.classList.add('active');
}

async function updateUserData() {
    if(!localStorage.token) return;
    try {
        const res = await fetch('/api/user', {
            headers: { 'Authorization': `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        if(data.ok) {
            const bal = `$${data.user.balance.toFixed(2)}`;
            document.getElementById('balance-val').innerText = bal;
            document.getElementById('wallet-val').innerText = bal;
            document.getElementById('profile-uid').innerText = "+1 (822) " + String(data.user.id).padStart(7, '0');
        } else {
            handleLogout();
        }
    } catch(e) { console.error(e); }
}

async function loadHistory() {
    try {
        const res = await fetch('/api/history', {
            headers: { 'Authorization': `Bearer ${localStorage.token}` }
        });
        const data = await res.json();
        if(data.ok) {
            const list = document.getElementById('recents-list');
            list.innerHTML = data.history.map(h => `
                <div class="list-card">
                    <div class="list-info">
                        <h4>${h.toNumber}</h4>
                        <p>${new Date(h.timestamp).toLocaleString('ar-YE')}</p>
                    </div>
                    <div class="list-amount">-$${h.cost.toFixed(2)}</div>
                </div>
            `).join('') || '<p style="text-align:center; padding:40px; color:#999;">لا يوجد مكالمات سابقة</p>';
        }
    } catch(e) { console.error(e); }
}

async function makeCall() {
    if(!currentNumber) return alert("أدخل الرقم أولاً");
    if(!twilioDevice) return alert("جاري تهيئة النظام، يرجى الانتظار...");

    try {
        document.getElementById('calling-num').innerText = currentNumber;
        document.getElementById('call-overlay').style.display = 'flex';
        document.getElementById('call-status').innerText = "جاري الاتصال...";
        
        const params = { To: currentNumber };
        activeCall = await twilioDevice.connect({ params });
    } catch(e) { 
        console.error(e);
        alert("حدث خطأ تقني في الاتصال");
        hangup();
    }
}

function startTimer() {
    callSeconds = 0;
    clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
        callSeconds++;
        const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
        const s = String(callSeconds % 60).padStart(2, '0');
        document.getElementById('call-timer').innerText = `${m}:${s}`;
    }, 1000);
}

function hangup() {
    if(activeCall) {
        activeCall.disconnect();
        activeCall = null;
    }
    clearInterval(callTimerInterval);
    document.getElementById('call-overlay').style.display = 'none';
    document.getElementById('call-timer').innerText = "00:00";
    currentNumber = "";
    updateDisplay();
    updateUserData();
}

function handleLogout() { localStorage.clear(); location.reload(); }
