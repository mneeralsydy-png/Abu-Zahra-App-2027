require('dotenv').config();
const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const admin = require('firebase-admin');
const fs = require('fs');

const app = express();

// --- الوسيطة ---
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// --- Firebase ---
let serviceAccount;
try {
    if (fs.existsSync('serviceAccount.json')) {
        serviceAccount = require('./serviceAccount.json');
    } else {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    }
} catch (e) { console.error("Firebase Config Error"); }

if (!admin.apps.length && serviceAccount.project_id) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://call-now-24582-default-rtdb.firebaseio.com"
    });
}
const db = admin.database();

// --- Twilio ---
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const apiKeySid = process.env.TWILIO_API_KEY;
const apiKeySecret = process.env.TWILIO_API_SECRET;
const appSid = process.env.TWILIO_APP_SID;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = twilio(accountSid, authToken);

// --- Route: إعداد المستخدم (لمنحينح الرصيد والرقم الفريد +1820) ---
app.post('/setup-user', async (req, res) => {
    const { uid, email } = req.body;
    if (!uid) return res.status(400).send("UID required");

    try {
        // التحقق من حالة المستخدم: هل هو جديد؟
        const userRef = db.ref('users/' + uid);
        const userSnap = await userRef.once('value');
        const userData = userSnap.val();

        // إذا كان المستخدم جديداً أو بياناته فارغة
        if (!userData) {
            // 1. منحح الهدية (مرة واحدة فقط لكل UID)
            const balanceRef = db.ref('users/' + uid + '/balance');
            balanceRef.transaction((currentBalance) => {
                const newBalance = (currentBalance || 0);
                if (newBalance < 1.00) {
                    console.log(`Granting $1 to new user ${uid}`);
                    return 1.00;
                }
                return newBalance;
            });

            // 2. توليد رقم فريد +1820 (عشوائي) مع التحقق من التكرار
            let uniqueAccountNumber = null;
            let attempts = 0;
            const maxAttempts = 20; 
            while (!uniqueAccountNumber && attempts < maxAttempts) {
                const randomPart = Math.floor(1000000 + Math.random() * 9000000);
                const candidateNumber = `+1820${randomPart}`;
                const numberCheck = db.ref('users').orderByChild('account_number').equalTo(candidateNumber).limitToFirst(1);
                const snapshot = await numberCheck.once('value');
                if (!snapshot.exists()) {
                    uniqueAccountNumber = candidateNumber;
                }
                attempts++;
            }

            if (uniqueAccountNumber) {
                await userRef.update({ 
                    account_number: uniqueAccountNumber,
                    email: email
                });
                console.log(`User ${uid} setup complete with $1 and Number: ${uniqueAccountNumber}`);
            } else {
                console.error(`Failed to generate unique number for user ${uid}`);
            }
        } else {
            console.log(`User ${uid} already has data. Skipping setup.`);
        }
        res.json({ success: true, message: "User setup complete" });

    } catch (error) {
        console.error("Setup Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- Route: توليد التوكن (Token) لـ Twilio Client ---
app.get('/token', (req, res) => {
    const identity = req.query.identity || 'user';
    const AccessToken = twilio.jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;
    const voiceGrant = new VoiceGrant({ outgoingApplicationSid: appSid, incomingAllow: true });
    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity: identity });
    token.addGrant(voiceGrant);
    res.send(token.toJwt());
});

// --- Route: معالجة اتصال الصوت (TwiML) ---
app.post('/voice', (req, res) => {
    const voiceResponse = new twilio.twiml.VoiceResponse();
    // قراءة الرقم المخصص للمستخدم ليكون هو هوية المستقبل الحقيقي
    db.ref('users/' + req.body.Caller + '/account_number').once('value', snap => {
        const callerNumber = snap.val() || process.env.TWILIO_PHONE_NUMBER; // Fallback رقم
        if (req.body.To) {
            voiceResponse.dial({ callerId: callerNumber, action: '/status-callback' }).number(req.body.To);
        } else voiceResponse.hangup();
        res.type('text/xml')
        res.send(voiceResponse.toString());
    });
});

// --- Route: حالة المكالمة وخصم الرصيد ---
app.post('/status-callback', (req, res) => {
    if (req.body.CallStatus === 'completed') {
        const duration = parseFloat(req.body.CallDuration || 0);
        const cost = (duration / 60) * 0.05; // تكلفة 5 سنت للدقيقة
        db.ref('users/' + req.body.Caller + '/balance').transaction(b => (b || 0) - cost);
        db.ref('users/' + req.body.Caller + '/logs').push({ 
            to: req.body.To, 
            type: 'outgoing', 
            date: Date.now(), 
            cost: cost,
            duration: duration
        });
    }
    res.send('');
});

// --- Route: إرسال رسالة SMS حقيقية ---
app.post('/send-sms', async (req, res) => {
    const { uid, to, body } = req.body;
    if (!uid || !to || !body) return res.status(400).send("Missing data");

    try {
        const msgCost = 0.05;
        const userBalRef = db.ref('users/' + uid + '/balance');
        await userBalRef.transaction(bal => {
            if ((bal || 0) < msgCost) throw new Error("Insufficient balance");
            return (bal || 0) - msgCost;
        });

        const message = await client.messages.create({
            body: body,
            from: twilioPhoneNumber,
            to: to
        });

        db.ref('users/' + uid + '/messages').push({ to: to, text: body, type: 'sent', date: Date.now(), cost: msgCost });
        res.json({ success: true, sid: message.sid });
    } catch (error) {
        console.error("SMS Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// --- Route: محاكاة الدفع ---
app.post('/update-balance', (req, res) => {
    const { uid, amount } = req.body;
    if (!uid || amount === undefined) return res.status(400).send("Invalid request");
    db.ref('users/' + uid + '/balance').transaction(b => (b || 0) + parseFloat(amount));
    res.json({ success: true, newBalance: amount });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
