const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const mineflayer = require('mineflayer');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'starting1k_super_secret_key_2026',
    resave: false,
    saveUninitialized: false
}));

// ----------------------------------------------------
// Database Setup & Initial Promo Codes
// ----------------------------------------------------
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'user',
        plan TEXT DEFAULT 'free',
        premium_until INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        plan_type TEXT, 
        duration_days INTEGER,
        max_uses INTEGER,
        used_count INTEGER DEFAULT 0,
        role_to_grant TEXT DEFAULT 'user'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        bot_name TEXT,
        ip TEXT,
        port INTEGER,
        status TEXT DEFAULT 'Offline'
    )`);

    // حساب الأونر وحساب الأدمن التجريبي
    bcrypt.hash('owner123', 10, (err, hash) => {
        db.run(`INSERT OR IGNORE INTO users (id, username, email, password, role, plan) VALUES (1, 'Owner_Starting1k', 'owner@starting1k.com', ?, 'owner', 'lifetime')`, [hash]);
    });
    bcrypt.hash('admin123', 10, (err, hash) => {
        db.run(`INSERT OR IGNORE INTO users (id, username, email, password, role, plan) VALUES (2, 'Admin_Test', 'admin@starting1k.com', ?, 'admin', 'lifetime')`, [hash]);
    });

    // دفعة الكودات الكاملة
    const codesToInsert = [
        ['W1-AZ99', 'temp', 7, 5, 'user'], ['W1-BX88', 'temp', 7, 5, 'user'], ['W1-CW77', 'temp', 7, 5, 'user'], ['W1-DV66', 'temp', 7, 5, 'user'], ['W1-EU55', 'temp', 7, 5, 'user'],
        ['W2-AK11', 'temp', 14, 5, 'user'], ['W2-BL22', 'temp', 14, 5, 'user'], ['W2-CM33', 'temp', 14, 5, 'user'], ['W2-DN44', 'temp', 14, 5, 'user'], ['W2-EP55', 'temp', 14, 5, 'user'],
        ['M1-ZX10', 'temp', 30, 5, 'user'], ['M1-YX20', 'temp', 30, 5, 'user'], ['M1-XX30', 'temp', 30, 5, 'user'], ['M1-WX40', 'temp', 30, 5, 'user'], ['M1-VX50', 'temp', 30, 5, 'user'],
        ['M3-AA12', 'temp', 90, 2, 'user'], ['M3-BB34', 'temp', 90, 2, 'user'], ['M3-CC56', 'temp', 90, 2, 'user'], ['M3-DD78', 'temp', 90, 2, 'user'], ['M3-EE90', 'temp', 90, 2, 'user'],
        ['ADM-KEY1', 'lifetime', 0, 1, 'admin'], ['ADM-KEY2', 'lifetime', 0, 1, 'admin'], ['ADM-KEY3', 'lifetime', 0, 1, 'admin'], ['ADM-KEY4', 'lifetime', 0, 1, 'admin'], ['ADM-KEY5', 'lifetime', 0, 1, 'admin'],
        ['OWNER-MASTER-2026', 'lifetime', 0, 1, 'owner'],
        ['LIFE-GOLD1', 'lifetime', 0, 1, 'user'], ['LIFE-GOLD2', 'lifetime', 0, 1, 'user']
    ];

    codesToInsert.forEach(([code, plan_type, duration_days, max_uses, role_to_grant]) => {
        db.run(`INSERT OR IGNORE INTO promo_codes (code, plan_type, duration_days, max_uses, role_to_grant) VALUES (?, ?, ?, ?, ?)`, 
            [code, plan_type, duration_days, max_uses, role_to_grant]);
    });
});

// ----------------------------------------------------
// Bot Management Engine (Mineflayer)
// ----------------------------------------------------
const activeBots = {};

function startBotProcess(botData) {
    const key = botData.id;
    if (activeBots[key] && activeBots[key].instance) return;

    const logs = [];
    const addLog = (msg) => {
        const time = new Date().toLocaleTimeString();
        logs.push(`[${time}] ${msg}`);
        if (logs.length > 40) logs.shift();
    };

    addLog(`جاري الاتصال بـ ${botData.ip}:${botData.port} باِسم ${botData.bot_name}...`);

    const bot = mineflayer.createBot({
        host: botData.ip,
        port: parseInt(botData.port),
        username: botData.bot_name,
        version: false
    });

    activeBots[key] = {
        instance: bot,
        logs: logs,
        health: 20,
        food: 20,
        status: 'Connecting',
        info: botData
    };

    let antiAFKInterval = null;

    bot.on('spawn', () => {
        addLog('تم الدخول بنجاح إلى السيرفر!');
        if (activeBots[key]) activeBots[key].status = 'Online';

        // تفادي الطرد Anti-AFK (تشفيت وقفز كل 20 ثانية)
        antiAFKInterval = setInterval(() => {
            if (!bot || !bot.entity) return;
            bot.setControlState('sneak', true);
            setTimeout(() => bot.setControlState('sneak', false), 1200);
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 500);
            addLog('تفادي الطرد: تم التشفيت والقفز تلقائياً.');
        }, 20000);
    });

    bot.on('health', () => {
        if (activeBots[key]) {
            activeBots[key].health = Math.round(bot.health);
            activeBots[key].food = Math.round(bot.food);
        }
    });

    bot.on('chat', (username, message) => {
        addLog(`<${username}> ${message}`);
    });

    bot.on('messagestr', (message) => {
        if (message) addLog(`[Server] ${message}`);
    });

    bot.on('error', (err) => {
        addLog(`خطأ: ${err.message}`);
    });

    bot.on('end', () => {
        addLog('انقطع الاتصال بالسيرفر! إعادة المحاولة بعد 10 ثوانٍ...');
        if (antiAFKInterval) clearInterval(antiAFKInterval);
        if (activeBots[key]) {
            activeBots[key].instance = null;
            activeBots[key].status = 'Reconnecting';
        }

        setTimeout(() => {
            db.get(`SELECT * FROM bots WHERE id = ?`, [botData.id], (err, row) => {
                if (row) startBotProcess(row);
            });
        }, 10000);
    });
}

function stopBotProcess(botId) {
    if (activeBots[botId] && activeBots[botId].instance) {
        activeBots[botId].instance.quit();
        activeBots[botId].instance = null;
        activeBots[botId].status = 'Stopped';
        activeBots[botId].logs.push(`[${new Date().toLocaleTimeString()}] تم إيقاف البوت يدويًا.`);
    }
}

// ----------------------------------------------------
// REST API Routes
// ----------------------------------------------------
app.post('/api/register', (req, res) => {
    const { username, email, password, confirmPassword } = req.body;
    if (password !== confirmPassword) return res.status(400).json({ error: 'كلمات المرور غير متطابقة' });

    bcrypt.hash(password, 10, (err, hash) => {
        db.run(`INSERT INTO users (username, email, password) VALUES (?, ?, ?)`, [username, email, hash], function(err) {
            if (err) return res.status(400).json({ error: 'اسم المستخدم أو البريد الإلكتروني مسجل مسبقاً' });
            res.json({ success: true });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, user) => {
        if (!user) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
        bcrypt.compare(password, user.password, (err, result) => {
            if (result) {
                req.session.userId = user.id;
                res.json({ success: true });
            } else {
                res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
            }
        });
    });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    db.get(`SELECT id, username, email, role, plan, premium_until FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        res.json(user);
    });
});

app.get('/api/bots', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    db.all(`SELECT * FROM bots WHERE user_id = ?`, [req.session.userId], (err, rows) => {
        const response = rows.map(b => {
            const live = activeBots[b.id];
            return {
                id: b.id,
                bot_name: b.bot_name,
                ip: b.ip,
                port: b.port,
                status: live ? live.status : 'Stopped',
                health: live ? live.health : 0,
                food: live ? live.food : 0,
                logs: live ? live.logs : []
            };
        });
        res.json(response);
    });
});

app.post('/api/bots/create', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    
    db.get(`SELECT * FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        db.all(`SELECT COUNT(*) as count FROM bots WHERE user_id = ?`, [req.session.userId], (err, rows) => {
            const count = rows[0].count;
            let maxBots = 2; // المجاني
            if (user.plan === 'temp') maxBots = 10;
            if (user.plan === 'lifetime' || user.role === 'admin' || user.role === 'owner') maxBots = 20;

            if (count >= maxBots) {
                return res.status(400).json({ error: `لقد وصلت للحد الأقصى المسموح به (${maxBots} بوتات)` });
            }

            let botName = req.body.bot_name;
            if ((user.plan === 'free' && user.role === 'user') || !botName) {
                botName = 'sub_to_starting22';
            }

            const { ip, port } = req.body;
            db.run(`INSERT INTO bots (user_id, bot_name, ip, port) VALUES (?, ?, ?, ?)`, 
                [user.id, botName, ip, port], function(err) {
                    const newBot = { id: this.lastID, user_id: user.id, bot_name: botName, ip, port };
                    startBotProcess(newBot);
                    res.json({ success: true });
            });
        });
    });
});

app.post('/api/bots/toggle', (req, res) => {
    const { botId, action } = req.body;
    if (action === 'stop') {
        stopBotProcess(botId);
        res.json({ success: true });
    } else {
        db.get(`SELECT * FROM bots WHERE id = ?`, [botId], (err, bot) => {
            if (bot) {
                startBotProcess(bot);
                res.json({ success: true });
            }
        });
    }
});

app.post('/api/bots/command', (req, res) => {
    const { botId, command } = req.body;
    const botObj = activeBots[botId];
    if (botObj && botObj.instance) {
        botObj.instance.chat(command);
        botObj.logs.push(`[شات المُستخدم]: ${command}`);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'البوت غير متصل حالياً' });
    }
});

app.post('/api/redeem', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    const { code } = req.body;

    db.get(`SELECT * FROM promo_codes WHERE code = ?`, [code], (err, promo) => {
        if (!promo || promo.used_count >= promo.max_uses) {
            return res.status(400).json({ error: 'الكود غير صالح أو تم استخدامه بالكامل' });
        }

        let expireTime = 0;
        if (promo.plan_type === 'temp') {
            expireTime = Date.now() + (promo.duration_days * 24 * 60 * 60 * 1000);
        }

        let updateQuery = `UPDATE users SET plan = ?, premium_until = ?`;
        let params = [promo.plan_type, expireTime];

        if (promo.role_to_grant && promo.role_to_grant !== 'user') {
            updateQuery += `, role = ?`;
            params.push(promo.role_to_grant);
        }
        updateQuery += ` WHERE id = ?`;
        params.push(req.session.userId);

        db.run(updateQuery, params, () => {
            db.run(`UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?`, [code]);
            res.json({ 
                success: true, 
                message: 'تم تفعيل البريميوم بنجاح!', 
                plan_type: promo.plan_type, 
                duration_days: promo.duration_days,
                role: promo.role_to_grant 
            });
        });
    });
});

app.get('/api/admin/users', (req, res) => {
    db.get(`SELECT role FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (!user || (user.role !== 'admin' && user.role !== 'owner')) return res.status(403).json({ error: 'ممنوع الدخول' });
        db.all(`SELECT id, username, email, plan, role FROM users`, (err, users) => {
            res.json(users);
        });
    });
});

// ----------------------------------------------------
// UI Server (HTML / CSS / JS with Purple Theme, Social Buttons & Periodic Modal)
// ----------------------------------------------------
app.get('*', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Starting 1k - Aternos 24/7 Bots</title>
    <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Tajawal', sans-serif; }
        body {
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(88, 28, 135, 0.85)), 
                        url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1920&auto=format&fit=crop');
            background-size: cover; background-position: center; background-attachment: fixed;
            color: #fff; min-height: 100vh; display: flex; flex-direction: column; align-items: center;
            overflow-x: hidden; position: relative;
        }
        header {
            width: 100%; padding: 20px 40px; background: rgba(0,0,0,0.5); backdrop-filter: blur(12px);
            display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid rgba(168, 85, 247, 0.3);
        }
        header h1 { font-size: 2.2rem; font-weight: 900; color: #c084fc; text-shadow: 0 0 15px rgba(192, 132, 252, 0.6); }
        .container { width: 90%; max-width: 1100px; margin: 30px auto; z-index: 2; position: relative; }
        .card {
            background: rgba(30, 41, 59, 0.8); backdrop-filter: blur(16px);
            border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 16px; padding: 30px; margin-bottom: 25px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.6);
        }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; color: #e9d5ff; }
        input {
            width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #7e22ce;
            background: rgba(15, 23, 42, 0.9); color: #fff; outline: none; font-size: 1rem;
        }
        input:focus { border-color: #c084fc; box-shadow: 0 0 8px rgba(192, 132, 252, 0.4); }
        .btn {
            padding: 12px 24px; border: none; border-radius: 8px; font-size: 1rem; font-weight: bold;
            cursor: pointer; transition: 0.3s; width: 100%;
            display: inline-flex; justify-content: center; align-items: center; gap: 8px;
        }
        .btn-purple { background: linear-gradient(135deg, #9333ea, #7e22ce); color: #fff; }
        .btn-purple:hover { background: linear-gradient(135deg, #a855f7, #9333ea); box-shadow: 0 0 12px rgba(168, 85, 247, 0.6); }
        
        .btn-yellow { background: #eab308; color: #000; }
        .btn-yellow:hover { background: #ca8a04; }
        
        .btn-discord { background: #5865F2; color: #fff; text-decoration: none; }
        .btn-discord:hover { background: #4752C4; }
        
        .btn-youtube { background: #FF0000; color: #fff; text-decoration: none; }
        .btn-youtube:hover { background: #CC0000; }

        .btn-danger { background: #ef4444; color: #fff; }
        
        .bot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
        .bot-card {
            background: rgba(15, 23, 42, 0.95); border-radius: 12px; padding: 20px; border: 1px solid rgba(168, 85, 247, 0.4);
            position: relative;
        }
        .bot-header { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
        .bot-avatar { width: 48px; height: 48px; border-radius: 8px; }
        .stats { display: flex; gap: 15px; margin: 10px 0; font-weight: bold; }
        .console-box {
            background: #000; color: #00ff66; height: 140px; font-family: monospace;
            padding: 10px; border-radius: 6px; overflow-y: auto; font-size: 0.85rem; margin-top: 10px;
            border: 1px solid #334155;
        }
        .badge { padding: 4px 10px; border-radius: 20px; font-size: 0.8rem; font-weight: bold; display: inline-flex; align-items: center; gap: 5px; }
        .badge-free { background: #64748b; }
        .badge-temp { background: #3b82f6; }
        .badge-life { background: #ef4444; }
        .badge-admin { background: #8b5cf6; }
        .badge-owner { background: #ec4899; }
        .hidden { display: none !important; }
        .nav-links { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
        .link { color: #d8b4fe; cursor: pointer; text-decoration: underline; }

        /* Periodic Promo Modal Popup */
        #periodicModal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.7); backdrop-filter: blur(8px); z-index: 10000;
            display: flex; justify-content: center; align-items: center;
        }
        .modal-content {
            background: linear-gradient(135deg, #1e1b4b, #312e81);
            border: 2px solid #a855f7; border-radius: 20px; padding: 40px; text-align: center;
            max-width: 420px; width: 90%; box-shadow: 0 0 30px rgba(168, 85, 247, 0.8);
            animation: popIn 0.4s ease;
        }
        @keyframes popIn {
            0% { transform: scale(0.8); opacity: 0; }
            100% { transform: scale(1); opacity: 1; }
        }

        #particleCanvas {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none; z-index: 999;
        }
    </style>
</head>
<body>

    <canvas id="particleCanvas"></canvas>

    <!-- Periodic Popup Modal (Appears every minute) -->
    <div id="periodicModal" class="hidden">
        <div class="modal-content">
            <h2 style="color: #f0abfc; margin-bottom: 15px;">🎁 احصل على أكواد بريميوم مجاناً!</h2>
            <p style="color: #e2e8f0; margin-bottom: 25px; line-height: 1.6;">انضم الآن إلى سيرفر الدسكورد الخاص بنا للحصول على أقوى الأكواد والفعاليات اليومية مجاناً!</p>
            <div style="display: flex; gap: 10px;">
                <a href="https://discord.gg/pWmz8X7aK" target="_blank" class="btn btn-discord" style="flex: 1;" onclick="closePeriodicModal()">حصول 🚀</a>
                <button onclick="closePeriodicModal()" class="btn btn-purple" style="flex: 1; background: #475569;">إغلاق</button>
            </div>
        </div>
    </div>

    <header>
        <h1>Starting 1k</h1>
        <div id="userInfo" class="nav-links hidden">
            <span id="userBadge"></span>
            <span id="userNameDisplay"></span>
            <button onclick="openPromoModal()" class="btn btn-yellow" style="width: auto; padding: 8px 14px;">🎁 كود بريميوم</button>
            
            <!-- Discord & Youtube Social Buttons -->
            <a href="https://discord.gg/pWmz8X7aK" target="_blank" class="btn btn-discord" style="width: auto; padding: 8px 14px; font-size: 0.9rem;">
                🎮 دسكورد
            </a>
            <a href="https://www.youtube.com/@%D8%AD%D9%85%D8%B2%D8%A9%D8%B2%D9%8A%D8%A7%D8%AA-%D8%B86%D8%B4" target="_blank" class="btn btn-youtube" style="width: auto; padding: 8px 14px; font-size: 0.9rem;">
                ▶️ يوتيوب
            </a>

            <button id="adminBtn" onclick="toggleAdminPanel()" class="btn btn-purple hidden" style="width: auto; padding: 8px 14px;">👤 إدارة المستخدمين</button>
            <span onclick="logout()" class="link">خروج</span>
        </div>
    </header>

    <div class="container">
        <!-- Auth Section -->
        <div id="authSection">
            <div id="loginCard" class="card" style="max-width: 450px; margin: 50px auto;">
                <h2>تسجيل الدخول</h2><br>
                <form onsubmit="handleLogin(event)">
                    <div class="form-group"><label>البريد الإلكتروني</label><input type="email" id="loginEmail" required></div>
                    <div class="form-group"><label>كلمة المرور</label><input type="password" id="loginPassword" required></div>
                    <p style="text-align: left; margin-bottom: 15px;"><a href="https://discord.gg/pWmz8X7aK" target="_blank" class="link">هل نسيت كلمة المرور؟</a></p>
                    <button type="submit" class="btn btn-purple">دخول</button>
                </form>
                <br><p>ليس لديك حساب؟ <span class="link" onclick="switchAuth('register')">إنشاء حساب جديد</span></p>
            </div>

            <div id="registerCard" class="card hidden" style="max-width: 450px; margin: 50px auto;">
                <h2>إنشاء حساب جديد</h2><br>
                <form onsubmit="handleRegister(event)">
                    <div class="form-group"><label>اسم المستخدم</label><input type="text" id="regUser" required></div>
                    <div class="form-group"><label>البريد الإلكتروني</label><input type="email" id="regEmail" required></div>
                    <div class="form-group"><label>كلمة المرور</label><input type="password" id="regPass" required></div>
                    <div class="form-group"><label>تأكيد كلمة المرور</label><input type="password" id="regConfirmPass" required></div>
                    <button type="submit" class="btn btn-purple">إنشاء حساب</button>
                </form>
                <br><p>لديك حساب بالفعل؟ <span class="link" onclick="switchAuth('login')">تسجيل الدخول</span></p>
            </div>
        </div>

        <!-- Dashboard Section -->
        <div id="dashboardSection" class="hidden">
            <div id="promoModal" class="card hidden">
                <h3>إدخال كود البريميوم 🎁</h3><br>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="promoInput" placeholder="أدخل كود التفعيل هنا">
                    <button onclick="redeemCode()" class="btn btn-purple" style="width: 160px;">تفعيل الكود</button>
                </div>
            </div>

            <div id="adminPanel" class="card hidden">
                <h3>لوحة إدارة المستخدمين والأدمن (Admin / Owner Panel)</h3><br>
                <div id="adminUsersList"></div>
            </div>

            <div class="card">
                <h2>إضافة بوت 24/7 جديد</h2><br>
                <form onsubmit="handleCreateBot(event)" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                    <div>
                        <label>اسم البوت</label>
                        <input type="text" id="botNameInput" placeholder="sub_to_starting22">
                        <small id="nameNote" style="color: #d8b4fe; font-size: 0.75rem;">(العادي: الاسم ثابت sub_to_starting22 | البريميوم: حر)</small>
                    </div>
                    <div>
                        <label>IP السيرفر</label>
                        <input type="text" id="botIp" placeholder="example.aternos.me" required>
                    </div>
                    <div>
                        <label>Port (المَنفذ)</label>
                        <input type="number" id="botPort" placeholder="25565" required>
                    </div>
                    <div style="display: flex; align-items: flex-end;">
                        <button type="submit" class="btn btn-purple">تشغيل البوت 🚀</button>
                    </div>
                </form>
            </div>

            <h2>البوتات النشطة الخاصة بك</h2><br>
            <div id="botsContainer" class="bot-grid"></div>
        </div>
    </div>

    <script>
        let currentUser = null;

        // Periodic Popup Modal Trigger (Every 1 minute / 60,000 ms)
        setInterval(() => {
            document.getElementById('periodicModal').classList.remove('hidden');
        }, 60000);

        function closePeriodicModal() {
            document.getElementById('periodicModal').classList.add('hidden');
        }

        // Particle System Script
        const canvas = document.getElementById('particleCanvas');
        const ctx = canvas.getContext('2d');
        let particles = [];

        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        function launchParticles(tier) {
            particles = [];
            let count = 30;
            let colors = ['#9333ea', '#c084fc', '#e9d5ff'];
            let speedMax = 5;

            if (tier === 'month') {
                count = 70;
                colors = ['#c084fc', '#eab308', '#f43f5e', '#34d399'];
                speedMax = 8;
            } else if (tier === 'lifetime' || tier === 'admin' || tier === 'owner') {
                count = 180;
                colors = ['#c084fc', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#ffffff'];
                speedMax = 14;
            }

            const centerX = window.innerWidth / 2;
            const centerY = window.innerHeight / 2;

            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = Math.random() * speedMax + 2;
                particles.push({
                    x: centerX, y: centerY,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    radius: Math.random() * 5 + 2,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    alpha: 1, decay: Math.random() * 0.015 + 0.008
                });
            }
            animateParticles();
        }

        function animateParticles() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach((p, index) => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.2;
                p.alpha -= p.decay;

                if (p.alpha <= 0) {
                    particles.splice(index, 1);
                    return;
                }

                ctx.save();
                ctx.globalAlpha = p.alpha;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });

            if (particles.length > 0) {
                requestAnimationFrame(animateParticles);
            }
        }

        function switchAuth(type) {
            document.getElementById('loginCard').classList.toggle('hidden', type !== 'login');
            document.getElementById('registerCard').classList.toggle('hidden', type !== 'register');
        }

        async function fetchUser() {
            const res = await fetch('/api/me');
            if (res.ok) {
                currentUser = await res.json();
                renderDashboard();
            } else {
                document.getElementById('authSection').classList.remove('hidden');
                document.getElementById('dashboardSection').classList.add('hidden');
                document.getElementById('userInfo').classList.add('hidden');
            }
        }

        function renderDashboard() {
            document.getElementById('authSection').classList.add('hidden');
            document.getElementById('dashboardSection').classList.remove('hidden');
            document.getElementById('userInfo').classList.remove('hidden');

            document.getElementById('userNameDisplay').innerText = currentUser.username;
            
            const badge = document.getElementById('userBadge');
            const botNameInput = document.getElementById('botNameInput');

            if (currentUser.role === 'owner') {
                badge.innerText = '👑 المالك الأكبر (Owner)';
                badge.className = 'badge badge-owner';
                botNameInput.disabled = false;
            } else if (currentUser.role === 'admin') {
                badge.innerText = '🛡️ مراقب عام (Admin)';
                badge.className = 'badge badge-admin';
                botNameInput.disabled = false;
            } else if (currentUser.plan === 'lifetime') {
                badge.innerText = '⭐ بريميوم مدى الحياة (20 بوت)';
                badge.className = 'badge badge-life';
                botNameInput.disabled = false;
            } else if (currentUser.plan === 'temp') {
                const daysLeft = Math.max(0, Math.ceil((currentUser.premium_until - Date.now()) / (1000 * 60 * 60 * 24)));
                badge.innerText = \`⏳ بريميوم (\${daysLeft} يوم) (10 بوتات)\`;
                badge.className = 'badge badge-temp';
                botNameInput.disabled = false;
            } else {
                badge.innerText = '🟢 حساب مجاني (2 بوت)';
                badge.className = 'badge badge-free';
                botNameInput.disabled = true;
                botNameInput.value = 'sub_to_starting22';
            }

            if (currentUser.role === 'admin' || currentUser.role === 'owner') {
                document.getElementById('adminBtn').classList.remove('hidden');
            }

            loadBots();
        }

        async function handleLogin(e) {
            e.preventDefault();
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    email: document.getElementById('loginEmail').value,
                    password: document.getElementById('loginPassword').value
                })
            });
            const data = await res.json();
            if (res.ok) fetchUser();
            else alert(data.error);
        }

        async function handleRegister(e) {
            e.preventDefault();
            const res = await fetch('/api/register', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    username: document.getElementById('regUser').value,
                    email: document.getElementById('regEmail').value,
                    password: document.getElementById('regPass').value,
                    confirmPassword: document.getElementById('regConfirmPass').value
                })
            });
            const data = await res.json();
            if (res.ok) { alert('تم الحساب بنجاح! قم بتسجيل الدخول الآن'); switchAuth('login'); }
            else alert(data.error);
        }

        async function handleCreateBot(e) {
            e.preventDefault();
            const res = await fetch('/api/bots/create', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    bot_name: document.getElementById('botNameInput').value,
                    ip: document.getElementById('botIp').value,
                    port: document.getElementById('botPort').value
                })
            });
            const data = await res.json();
            if (res.ok) loadBots();
            else alert(data.error);
        }

        async function loadBots() {
            const res = await fetch('/api/bots');
            const bots = await res.json();
            const container = document.getElementById('botsContainer');
            container.innerHTML = '';

            bots.forEach(bot => {
                const card = document.createElement('div');
                card.className = 'bot-card';
                card.innerHTML = \`
                    <div class="bot-header">
                        <img class="bot-avatar" src="https://mc-heads.net/avatar/\${bot.bot_name}/48" alt="Skin Head">
                        <div>
                            <h4>\${bot.bot_name}</h4>
                            <small>\${bot.ip}:\${bot.port}</small>
                        </div>
                    </div>
                    <div>الحالة: <b>\${bot.status}</b></div>
                    <div class="stats">
                        <span>❤️ \${bot.health}/20</span>
                        <span>🍖 \${bot.food}/20</span>
                    </div>
                    <div class="console-box" id="console-\${bot.id}">\${bot.logs.join('<br>')}</div>
                    <div style="margin-top:10px; display:flex; gap:5px;">
                        <input type="text" id="cmd-\${bot.id}" placeholder="اكتب شات/أمر هنا..." style="padding:6px; font-size:0.8rem;">
                        <button onclick="sendCommand(\${bot.id})" class="btn btn-purple" style="width: auto; padding:6px 12px;">إرسال</button>
                    </div>
                    <button onclick="toggleBot(\${bot.id}, '\${bot.status === 'Offline' || bot.status === 'Stopped' ? 'start' : 'stop'}')" 
                            class="btn \${bot.status === 'Offline' || bot.status === 'Stopped' ? 'btn-purple' : 'btn-danger'}" 
                            style="margin-top:10px;">
                        \${bot.status === 'Offline' || bot.status === 'Stopped' ? 'تشغيل' : 'إيقاف البوت'}
                    </button>
                \`;
                container.appendChild(card);
                const consoleBox = document.getElementById(\`console-\${bot.id}\`);
                consoleBox.scrollTop = consoleBox.scrollHeight;
            });
        }

        async function sendCommand(botId) {
            const input = document.getElementById(\`cmd-\${botId}\`);
            const command = input.value;
            if (!command) return;
            await fetch('/api/bots/command', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ botId, command })
            });
            input.value = '';
            loadBots();
        }

        async function toggleBot(botId, action) {
            await fetch('/api/bots/toggle', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ botId, action })
            });
            loadBots();
        }

        function openPromoModal() {
            document.getElementById('promoModal').classList.toggle('hidden');
        }

        async function redeemCode() {
            const code = document.getElementById('promoInput').value;
            const res = await fetch('/api/redeem', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ code })
            });
            const data = await res.json();
            if (res.ok) {
                alert(data.message);
                if (data.role === 'owner' || data.role === 'admin' || data.plan_type === 'lifetime') {
                    launchParticles('lifetime');
                } else if (data.duration_days >= 30) {
                    launchParticles('month');
                } else {
                    launchParticles('week');
                }
                fetchUser();
                openPromoModal();
            } else {
                alert(data.error);
            }
        }

        async function toggleAdminPanel() {
            const panel = document.getElementById('adminPanel');
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) {
                const res = await fetch('/api/admin/users');
                const users = await res.json();
                const list = document.getElementById('adminUsersList');
                list.innerHTML = users.map(u => \`
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid rgba(168,85,247,0.2);">
                        <span>ID: \${u.id} | <b>\${u.username}</b> (\${u.email})</span>
                        <span>الرتبة: <b>\${u.role}</b> | الباقة: <b>\${u.plan}</b></span>
                    </div>
                \`).join('');
            }
        }

        async function logout() {
            await fetch('/api/logout');
            location.reload();
        }

        fetchUser();
        setInterval(loadBots, 4000);
    </script>
</body>
</html>
    `);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Starting 1k Server running on port ${PORT}`));
