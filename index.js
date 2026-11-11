const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const mineflayer = require('mineflayer');
const http = require('http');

const app = express();
const server = http.createServer(app);

const DEFAULT_BOT_NAME = 'sub_to_starting';

const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret_in_railway_variables';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'owner123';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DB_PATH = process.env.DB_PATH || './database.db';

process.on('uncaughtException', (err) => console.error('uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

const db = new sqlite3.Database(DB_PATH);

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
        status TEXT DEFAULT 'Offline',
        autostart INTEGER DEFAULT 1
    )`);

    db.run(`ALTER TABLE bots ADD COLUMN autostart INTEGER DEFAULT 1`, () => {});

    const ownerHash = bcrypt.hashSync(OWNER_PASSWORD, 10);
    const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    db.run(`INSERT OR IGNORE INTO users (id, username, email, password, role, plan) VALUES (1, 'Owner_Starting1k', 'owner@starting1k.com', ?, 'owner', 'lifetime')`, [ownerHash]);
    db.run(`INSERT OR IGNORE INTO users (id, username, email, password, role, plan) VALUES (2, 'Admin_Test', 'admin@starting1k.com', ?, 'admin', 'lifetime')`, [adminHash]);

    const codesToInsert = [
        ['W1-AZ99', 'temp', 7, 5, 'user'], ['W1-BX88', 'temp', 7, 5, 'user'], ['W1-CW77', 'temp', 7, 5, 'user'], ['W1-DV66', 'temp', 7, 5, 'user'], ['W1-EU55', 'temp', 7, 5, 'user'],
        ['W2-AK11', 'temp', 14, 5, 'user'], ['W2-BL22', 'temp', 14, 5, 'user'], ['W2-CM33', 'temp', 14, 5, 'user'], ['W2-DN44', 'temp', 14, 5, 'user'], ['W2-EP55', 'temp', 14, 5, 'user'],
        ['M1-ZX10', 'temp', 30, 5, 'user'], ['M1-YX20', 'temp', 30, 5, 'user'], ['M1-XX30', 'temp', 30, 5, 'user'], ['M1-WX40', 'temp', 30, 5, 'user'], ['M1-VX50', 'temp', 30, 5, 'user'],
        ['M3-AA12', 'temp', 90, 2, 'user'], ['M3-BB34', 'temp', 90, 2, 'user'], ['M3-CC56', 'temp', 90, 2, 'user'], ['M3-DD78', 'temp', 90, 2, 'user'], ['M3-EE90', 'temp', 90, 2, 'user'],
        ['ADM-KEY1', 'lifetime', 0, 1, 'admin'], ['ADM-KEY2', 'lifetime', 0, 1, 'admin'], ['ADM-KEY3', 'lifetime', 0, 1, 'admin'], ['ADM-KEY4', 'lifetime', 0, 1, 'admin'], ['ADM-KEY5', 'lifetime', 0, 1, 'admin'],
        ['LIFE-GOLD1', 'lifetime', 0, 1, 'user'], ['LIFE-GOLD2', 'lifetime', 0, 1, 'user']
    ];

    codesToInsert.forEach(([code, plan_type, duration_days, max_uses, role_to_grant]) => {
        db.run(`INSERT OR IGNORE INTO promo_codes (code, plan_type, duration_days, max_uses, role_to_grant) VALUES (?, ?, ?, ?, ?)`,
            [code, plan_type, duration_days, max_uses, role_to_grant]);
    });

    db.all(`SELECT * FROM bots WHERE autostart = 1`, (err, rows) => {
        if (err || !rows) return;
        rows.forEach((row, i) => {
            setTimeout(() => startBotProcess(row), 2000 * (i + 1));
        });
    });
});

function getUser(id, cb) {
    db.get(`SELECT * FROM users WHERE id = ?`, [id], (err, user) => {
        if (err || !user) return cb(null);
        if (user.plan === 'temp' && user.premium_until && user.premium_until < Date.now()) {
            user.plan = 'free';
            user.premium_until = 0;
            db.run(`UPDATE users SET plan = 'free', premium_until = 0 WHERE id = ?`, [id]);
        }
        cb(user);
    });
}

function maxBotsFor(user) {
    if (user.role === 'admin' || user.role === 'owner' || user.plan === 'lifetime') return 20;
    if (user.plan === 'temp') return 10;
    return 2;
}

function isPremium(user) {
    return user.role === 'admin' || user.role === 'owner' || user.plan === 'lifetime' || user.plan === 'temp';
}

const activeBots = {};

function startBotProcess(botData) {
    const key = botData.id;
    const existing = activeBots[key];
    if (existing && (existing.instance || existing.reconnectTimer)) return;

    const entry = existing || { logs: [], health: 0, food: 0, safeMode: process.env.BOT_JUMP === 'false' };
    entry.manualStop = false;
    entry.status = 'Connecting';
    entry.info = botData;
    entry.instance = null;
    entry.reconnectTimer = null;
    activeBots[key] = entry;

    const addLog = (msg) => {
        entry.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
        if (entry.logs.length > 40) entry.logs.shift();
    };

    const host = String(botData.ip).trim();
    const port = parseInt(botData.port) || 25565;
    addLog(`جاري الاتصال بـ ${host}:${port} باسم ${botData.bot_name}...`);

    let bot;
    try {
        bot = mineflayer.createBot({
            host: host,
            port: port,
            username: botData.bot_name,
            auth: 'offline',
            version: process.env.BOT_VERSION || false,
            hideErrors: true
        });
    } catch (e) {
        addLog(`فشل إنشاء البوت: ${e.message}`);
        entry.status = 'Stopped';
        return;
    }
    entry.instance = bot;

    let afkInterval = null;

    bot.on('login', () => addLog('تم تسجيل الدخول، جاري التحميل...'));

    bot.on('spawn', async () => {
        addLog('تم الدخول بنجاح إلى السيرفر!');
        entry.status = 'Online';
        if (afkInterval) clearInterval(afkInterval);
        try { await bot.waitForChunksToLoad(); } catch (e) {}
        await new Promise((r) => setTimeout(r, 3000));
        if (entry.instance !== bot) return;
        if (afkInterval) clearInterval(afkInterval);
        afkInterval = setInterval(() => {
            if (!bot.entity) return;
            try {
                bot.setControlState('sneak', true);
                setTimeout(() => { try { bot.setControlState('sneak', false); } catch (e) {} }, 1000);
                if (!entry.safeMode && bot.entity.onGround) {
                    bot.setControlState('jump', true);
                    setTimeout(() => { try { bot.setControlState('jump', false); } catch (e) {} }, 400);
                } else if (entry.safeMode) {
                    bot.swingArm('right');
                }
            } catch (e) {}
        }, 5000);
    });

    bot.on('health', () => {
        entry.health = Math.round(bot.health || 0);
        entry.food = Math.round(bot.food || 0);
    });

    bot.on('messagestr', (m) => { if (m) addLog(`[Server] ${m}`); });

    bot.on('kicked', (reason) => {
        let text = typeof reason === 'string' ? reason : JSON.stringify(reason);
        addLog(`تم الطرد: ${text}`);
        if (text.indexOf('invalid_player_movement') !== -1 && !entry.safeMode) {
            entry.safeMode = true;
            addLog('تم تفعيل الوضع الآمن: بدون قفز، انحناء وتحريك اليد فقط.');
        }
    });

    bot.on('error', (err) => addLog(`خطأ: ${err.message}`));

    bot.once('end', () => {
        if (afkInterval) clearInterval(afkInterval);
        if (entry.instance && entry.instance !== bot) return;
        entry.instance = null;
        entry.health = 0;
        entry.food = 0;

        if (entry.manualStop) {
            entry.status = 'Stopped';
            return;
        }
        addLog('انقطع الاتصال! إعادة المحاولة بعد 10 ثوانٍ...');
        entry.status = 'Reconnecting';
        entry.reconnectTimer = setTimeout(() => {
            entry.reconnectTimer = null;
            if (entry.manualStop) return;
            db.get(`SELECT * FROM bots WHERE id = ?`, [botData.id], (err, row) => {
                if (row) startBotProcess(row);
            });
        }, 10000);
    });
}

function stopBotProcess(botId) {
    const entry = activeBots[botId];
    if (!entry) return;
    entry.manualStop = true;
    if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
    }
    if (entry.instance) {
        try { entry.instance.quit(); } catch (e) {}
        try { entry.instance.end(); } catch (e) {}
        entry.instance = null;
    }
    entry.status = 'Stopped';
    entry.health = 0;
    entry.food = 0;
    entry.logs.push(`[${new Date().toLocaleTimeString()}] تم إيقاف البوت يدويًا.`);
}

app.post('/api/register', (req, res) => {
    const { username, email, password, confirmPassword } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ error: 'يرجى ملء جميع الحقول' });
    if (!/^[A-Za-z0-9_\u0600-\u06FF]{3,20}$/.test(username)) return res.status(400).json({ error: 'اسم المستخدم يجب أن يكون 3-20 حرفاً بدون مسافات' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'البريد الإلكتروني غير صالح' });
    if (String(password).length < 6) return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 6 أحرف' });
    if (password !== confirmPassword) return res.status(400).json({ error: 'كلمات المرور غير متطابقة' });

    bcrypt.hash(password, 10, (err, hash) => {
        if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
        db.run(`INSERT INTO users (username, email, password) VALUES (?, ?, ?)`, [username, String(email).toLowerCase(), hash], function (err) {
            if (err) return res.status(400).json({ error: 'اسم المستخدم أو البريد الإلكتروني مسجل مسبقاً' });
            res.json({ success: true });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
    db.get(`SELECT * FROM users WHERE email = ?`, [String(email).toLowerCase()], (err, user) => {
        if (err || !user) return res.status(400).json({ error: 'بيانات الدخول غير صحيحة' });
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
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    getUser(req.session.userId, (user) => {
        if (!user) return res.status(401).json({ error: 'غير مسجل' });
        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            plan: user.plan,
            premium_until: user.premium_until
        });
    });
});

app.get('/api/bots', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    db.all(`SELECT * FROM bots WHERE user_id = ?`, [req.session.userId], (err, rows) => {
        if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
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

    getUser(req.session.userId, (user) => {
        if (!user) return res.status(401).json({ error: 'غير مسجل' });

        db.get(`SELECT COUNT(*) as count FROM bots WHERE user_id = ?`, [user.id], (err, row) => {
            if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
            const maxBots = maxBotsFor(user);
            if (row.count >= maxBots) {
                return res.status(400).json({ error: `لقد وصلت للحد الأقصى المسموح به (${maxBots} بوتات)` });
            }

            let { bot_name, ip, port } = req.body || {};

            let botName = String(bot_name || '').trim();
            if (!isPremium(user) || !botName) botName = DEFAULT_BOT_NAME;
            if (!/^[A-Za-z0-9_]{3,16}$/.test(botName)) {
                return res.status(400).json({ error: 'اسم البوت يجب أن يكون 3-16 حرفاً (إنجليزي وأرقام و _ فقط)' });
            }

            let host = String(ip || '').trim().replace(/^https?:\/\//, '');
            let portNum = parseInt(port);
            if (host.includes(':')) {
                const parts = host.split(':');
                host = parts[0];
                if (!portNum) portNum = parseInt(parts[1]);
            }
            if (!portNum) portNum = 25565;
            if (!/^[A-Za-z0-9.\-_]{1,253}$/.test(host)) return res.status(400).json({ error: 'عنوان السيرفر غير صالح' });
            if (portNum < 1 || portNum > 65535) return res.status(400).json({ error: 'المنفذ غير صالح' });

            db.run(`INSERT INTO bots (user_id, bot_name, ip, port, autostart) VALUES (?, ?, ?, ?, 1)`,
                [user.id, botName, host, portNum], function (err) {
                    if (err) return res.status(500).json({ error: 'تعذر إنشاء البوت' });
                    const newBot = { id: this.lastID, user_id: user.id, bot_name: botName, ip: host, port: portNum };
                    startBotProcess(newBot);
                    res.json({ success: true });
                });
        });
    });
});

app.post('/api/bots/toggle', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    const { botId, action } = req.body || {};
    db.get(`SELECT * FROM bots WHERE id = ? AND user_id = ?`, [botId, req.session.userId], (err, bot) => {
        if (err || !bot) return res.status(404).json({ error: 'البوت غير موجود' });
        if (action === 'stop') {
            stopBotProcess(bot.id);
            db.run(`UPDATE bots SET autostart = 0 WHERE id = ?`, [bot.id]);
        } else {
            startBotProcess(bot);
            db.run(`UPDATE bots SET autostart = 1 WHERE id = ?`, [bot.id]);
        }
        res.json({ success: true });
    });
});

app.post('/api/bots/delete', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    const { botId } = req.body || {};
    db.get(`SELECT * FROM bots WHERE id = ? AND user_id = ?`, [botId, req.session.userId], (err, bot) => {
        if (err || !bot) return res.status(404).json({ error: 'البوت غير موجود' });
        stopBotProcess(bot.id);
        delete activeBots[bot.id];
        db.run(`DELETE FROM bots WHERE id = ?`, [bot.id], () => res.json({ success: true }));
    });
});

app.post('/api/bots/command', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    const { botId, command } = req.body || {};
    if (!command || String(command).length > 256) return res.status(400).json({ error: 'الأمر غير صالح' });
    db.get(`SELECT id FROM bots WHERE id = ? AND user_id = ?`, [botId, req.session.userId], (err, bot) => {
        if (err || !bot) return res.status(404).json({ error: 'البوت غير موجود' });
        const botObj = activeBots[bot.id];
        if (botObj && botObj.instance) {
            try {
                botObj.instance.chat(String(command));
                botObj.logs.push(`[${new Date().toLocaleTimeString()}] [شات المُستخدم]: ${command}`);
                res.json({ success: true });
            } catch (e) {
                res.status(400).json({ error: 'تعذر إرسال الرسالة' });
            }
        } else {
            res.status(400).json({ error: 'البوت غير متصل حالياً' });
        }
    });
});

app.post('/api/redeem', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    const code = String((req.body && req.body.code) || '').trim();
    if (!code) return res.status(400).json({ error: 'أدخل الكود' });

    getUser(req.session.userId, (user) => {
        if (!user) return res.status(401).json({ error: 'غير مسجل' });

        db.get(`SELECT * FROM promo_codes WHERE code = ?`, [code], (err, promo) => {
            if (err || !promo || promo.used_count >= promo.max_uses) {
                return res.status(400).json({ error: 'الكود غير صالح أو تم استخدامه بالكامل' });
            }

            if (user.plan === 'lifetime' && promo.plan_type === 'temp') {
                return res.status(400).json({ error: 'حسابك بريميوم مدى الحياة بالفعل' });
            }

            db.run(`UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ? AND used_count < max_uses`, [code], function (err) {
                if (err || this.changes === 0) {
                    return res.status(400).json({ error: 'الكود غير صالح أو تم استخدامه بالكامل' });
                }

                let expireTime = 0;
                if (promo.plan_type === 'temp') {
                    const base = (user.plan === 'temp' && user.premium_until > Date.now()) ? user.premium_until : Date.now();
                    expireTime = base + (promo.duration_days * 24 * 60 * 60 * 1000);
                }

                let updateQuery = `UPDATE users SET plan = ?, premium_until = ?`;
                const params = [promo.plan_type, expireTime];
                if (promo.role_to_grant && promo.role_to_grant !== 'user') {
                    updateQuery += `, role = ?`;
                    params.push(promo.role_to_grant);
                }
                updateQuery += ` WHERE id = ?`;
                params.push(user.id);

                db.run(updateQuery, params, () => {
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
    });
});

app.get('/api/admin/users', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'غير مسجل' });
    db.get(`SELECT role FROM users WHERE id = ?`, [req.session.userId], (err, user) => {
        if (!user || (user.role !== 'admin' && user.role !== 'owner')) return res.status(403).json({ error: 'ممنوع الدخول' });
        db.all(`SELECT id, username, email, plan, role FROM users`, (err, users) => {
            res.json(users || []);
        });
    });
});

const PAGE_HTML = `<!DOCTYPE html>
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
            display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;
            border-bottom: 2px solid rgba(168, 85, 247, 0.3);
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
        input:disabled { opacity: 0.6; cursor: not-allowed; }
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
        .btn-gray { background: #475569; color: #fff; }
        .bot-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
        .bot-card {
            background: rgba(15, 23, 42, 0.95); border-radius: 12px; padding: 20px; border: 1px solid rgba(168, 85, 247, 0.4);
            position: relative;
        }
        .bot-header { display: flex; align-items: center; gap: 15px; margin-bottom: 15px; }
        .bot-avatar { width: 48px; height: 48px; border-radius: 8px; }
        .stats { display: flex; gap: 15px; margin: 10px 0; font-weight: bold; }
        .console-box {
            background: #000; color: #00ff66; height: 140px; font-family: monospace; direction: ltr; text-align: left;
            padding: 10px; border-radius: 6px; overflow-y: auto; font-size: 0.85rem; margin-top: 10px;
            border: 1px solid #334155; word-break: break-word;
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

    <div id="periodicModal" class="hidden">
        <div class="modal-content">
            <h2 style="color: #f0abfc; margin-bottom: 15px;">🎁 احصل على أكواد بريميوم مجاناً!</h2>
            <p style="color: #e2e8f0; margin-bottom: 25px; line-height: 1.6;">انضم الآن إلى سيرفر الدسكورد الخاص بنا للحصول على أقوى الأكواد والفعاليات اليومية مجاناً!</p>
            <div style="display: flex; gap: 10px;">
                <a href="https://discord.gg/pWmz8X7aK" target="_blank" rel="noopener" class="btn btn-discord" style="flex: 1;" onclick="closePeriodicModal()">حصول 🚀</a>
                <button onclick="closePeriodicModal()" class="btn btn-gray" style="flex: 1;">إغلاق</button>
            </div>
        </div>
    </div>

    <header>
        <h1>Starting 1k</h1>
        <div id="userInfo" class="nav-links hidden">
            <span id="userBadge"></span>
            <span id="userNameDisplay"></span>
            <button onclick="openPromoModal()" class="btn btn-yellow" style="width: auto; padding: 8px 14px;">🎁 كود بريميوم</button>
            <a href="https://discord.gg/pWmz8X7aK" target="_blank" rel="noopener" class="btn btn-discord" style="width: auto; padding: 8px 14px; font-size: 0.9rem;">🎮 دسكورد</a>
            <a href="https://www.youtube.com/@%D8%AD%D9%85%D8%B2%D8%A9%D8%B2%D9%8A%D8%A7%D8%AA-%D8%B86%D8%B4" target="_blank" rel="noopener" class="btn btn-youtube" style="width: auto; padding: 8px 14px; font-size: 0.9rem;">▶️ يوتيوب</a>
            <button id="adminBtn" onclick="toggleAdminPanel()" class="btn btn-purple hidden" style="width: auto; padding: 8px 14px;">👤 إدارة المستخدمين</button>
            <span onclick="logout()" class="link">خروج</span>
        </div>
    </header>

    <div class="container">
        <div id="authSection">
            <div id="loginCard" class="card" style="max-width: 450px; margin: 50px auto;">
                <h2>تسجيل الدخول</h2><br>
                <form onsubmit="handleLogin(event)">
                    <div class="form-group"><label>البريد الإلكتروني</label><input type="email" id="loginEmail" required></div>
                    <div class="form-group"><label>كلمة المرور</label><input type="password" id="loginPassword" required></div>
                    <p style="text-align: left; margin-bottom: 15px;"><a href="https://discord.gg/pWmz8X7aK" target="_blank" rel="noopener" class="link">هل نسيت كلمة المرور؟</a></p>
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

        <div id="dashboardSection" class="hidden">
            <div id="promoModal" class="card hidden">
                <h3>إدخال كود البريميوم 🎁</h3><br>
                <div style="display: flex; gap: 10px;">
                    <input type="text" id="promoInput" placeholder="أدخل كود التفعيل هنا">
                    <button onclick="redeemCode()" class="btn btn-purple" style="width: 160px;">تفعيل الكود</button>
                </div>
            </div>

            <div id="adminPanel" class="card hidden">
                <h3>لوحة إدارة المستخدمين (Admin / Owner Panel)</h3><br>
                <div id="adminUsersList"></div>
            </div>

            <div class="card">
                <h2>إضافة بوت 24/7 جديد</h2><br>
                <form onsubmit="handleCreateBot(event)" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
                    <div>
                        <label>اسم البوت</label>
                        <input type="text" id="botNameInput" placeholder="__DEFAULT_NAME__" maxlength="16">
                        <small style="color: #d8b4fe; font-size: 0.75rem;">(المجاني: الاسم ثابت __DEFAULT_NAME__ | البريميوم: حر، 16 حرف كحد أقصى)</small>
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
        var DEFAULT_NAME = '__DEFAULT_NAME__';
        var currentUser = null;

        function esc(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function post(url, body) {
            return fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {})
            });
        }

        setInterval(function () {
            document.getElementById('periodicModal').classList.remove('hidden');
        }, 60000);

        function closePeriodicModal() {
            document.getElementById('periodicModal').classList.add('hidden');
        }

        var canvas = document.getElementById('particleCanvas');
        var ctx = canvas.getContext('2d');
        var particles = [];

        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        function launchParticles(tier) {
            particles = [];
            var count = 30;
            var colors = ['#9333ea', '#c084fc', '#e9d5ff'];
            var speedMax = 5;

            if (tier === 'month') {
                count = 70;
                colors = ['#c084fc', '#eab308', '#f43f5e', '#34d399'];
                speedMax = 8;
            } else if (tier === 'lifetime') {
                count = 180;
                colors = ['#c084fc', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#ffffff'];
                speedMax = 14;
            }

            var centerX = window.innerWidth / 2;
            var centerY = window.innerHeight / 2;

            for (var i = 0; i < count; i++) {
                var angle = Math.random() * Math.PI * 2;
                var speed = Math.random() * speedMax + 2;
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
            particles = particles.filter(function (p) { return p.alpha > 0; });
            particles.forEach(function (p) {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.2;
                p.alpha -= p.decay;
                if (p.alpha <= 0) return;
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
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        }

        function switchAuth(type) {
            document.getElementById('loginCard').classList.toggle('hidden', type !== 'login');
            document.getElementById('registerCard').classList.toggle('hidden', type !== 'register');
        }

        async function fetchUser() {
            var res = await fetch('/api/me');
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

            var badge = document.getElementById('userBadge');
            var botNameInput = document.getElementById('botNameInput');

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
                var daysLeft = Math.max(0, Math.ceil((currentUser.premium_until - Date.now()) / (1000 * 60 * 60 * 24)));
                badge.innerText = '⏳ بريميوم (' + daysLeft + ' يوم) (10 بوتات)';
                badge.className = 'badge badge-temp';
                botNameInput.disabled = false;
            } else {
                badge.innerText = '🟢 حساب مجاني (2 بوت)';
                badge.className = 'badge badge-free';
                botNameInput.disabled = true;
                botNameInput.value = DEFAULT_NAME;
            }

            if (currentUser.role === 'admin' || currentUser.role === 'owner') {
                document.getElementById('adminBtn').classList.remove('hidden');
            }

            loadBots();
        }

        async function handleLogin(e) {
            e.preventDefault();
            var res = await post('/api/login', {
                email: document.getElementById('loginEmail').value,
                password: document.getElementById('loginPassword').value
            });
            var data = await res.json();
            if (res.ok) fetchUser();
            else alert(data.error);
        }

        async function handleRegister(e) {
            e.preventDefault();
            var res = await post('/api/register', {
                username: document.getElementById('regUser').value,
                email: document.getElementById('regEmail').value,
                password: document.getElementById('regPass').value,
                confirmPassword: document.getElementById('regConfirmPass').value
            });
            var data = await res.json();
            if (res.ok) { alert('تم إنشاء الحساب بنجاح! قم بتسجيل الدخول الآن'); switchAuth('login'); }
            else alert(data.error);
        }

        async function handleCreateBot(e) {
            e.preventDefault();
            var res = await post('/api/bots/create', {
                bot_name: document.getElementById('botNameInput').value,
                ip: document.getElementById('botIp').value,
                port: document.getElementById('botPort').value
            });
            var data = await res.json();
            if (res.ok) loadBots();
            else alert(data.error);
        }

        var STATUS_TEXT = {
            Online: '🟢 متصل',
            Connecting: '🟡 جاري الاتصال',
            Reconnecting: '🟠 إعادة الاتصال',
            Stopped: '🔴 متوقف',
            Offline: '🔴 متوقف'
        };

        async function loadBots() {
            var ae = document.activeElement;
            if (ae && ae.id && ae.id.indexOf('cmd-') === 0) return;

            var res = await fetch('/api/bots');
            if (!res.ok) return;
            var bots = await res.json();
            var container = document.getElementById('botsContainer');

            var scrolls = {};
            bots.forEach(function (b) {
                var el = document.getElementById('console-' + b.id);
                if (el) scrolls[b.id] = { top: el.scrollTop, atBottom: el.scrollTop + el.clientHeight >= el.scrollHeight - 5 };
            });

            var html = '';
            bots.forEach(function (bot) {
                var stopped = (bot.status === 'Offline' || bot.status === 'Stopped');
                var logsHtml = bot.logs.map(esc).join('<br>');
                html += '<div class="bot-card">' +
                    '<div class="bot-header">' +
                        '<img class="bot-avatar" src="https://mc-heads.net/avatar/' + encodeURIComponent(bot.bot_name) + '/48" alt="Skin">' +
                        '<div><h4>' + esc(bot.bot_name) + '</h4><small>' + esc(bot.ip) + ':' + esc(bot.port) + '</small></div>' +
                    '</div>' +
                    '<div>الحالة: <b>' + (STATUS_TEXT[bot.status] || esc(bot.status)) + '</b></div>' +
                    '<div class="stats"><span>❤️ ' + bot.health + '/20</span><span>🍖 ' + bot.food + '/20</span></div>' +
                    '<div class="console-box" id="console-' + bot.id + '">' + logsHtml + '</div>' +
                    '<div style="margin-top:10px; display:flex; gap:5px;">' +
                        '<input type="text" id="cmd-' + bot.id + '" placeholder="اكتب شات/أمر هنا..." maxlength="256" style="padding:6px; font-size:0.8rem;">' +
                        '<button data-act="send" data-id="' + bot.id + '" class="btn btn-purple" style="width:auto; padding:6px 12px;">إرسال</button>' +
                    '</div>' +
                    '<button data-act="' + (stopped ? 'start' : 'stop') + '" data-id="' + bot.id + '" class="btn ' + (stopped ? 'btn-purple' : 'btn-danger') + '" style="margin-top:10px;">' +
                        (stopped ? 'تشغيل' : 'إيقاف البوت') + '</button>' +
                    '<button data-act="delete" data-id="' + bot.id + '" class="btn btn-gray" style="margin-top:8px;">🗑️ حذف البوت</button>' +
                '</div>';
            });
            container.innerHTML = html;

            bots.forEach(function (b) {
                var el = document.getElementById('console-' + b.id);
                if (!el) return;
                var s = scrolls[b.id];
                if (!s || s.atBottom) el.scrollTop = el.scrollHeight;
                else el.scrollTop = s.top;
            });
        }

        document.getElementById('botsContainer').addEventListener('click', function (e) {
            var btn = e.target.closest('button[data-act]');
            if (!btn) return;
            var id = parseInt(btn.getAttribute('data-id'));
            var act = btn.getAttribute('data-act');
            if (act === 'send') sendCommand(id);
            else if (act === 'start' || act === 'stop') toggleBot(id, act);
            else if (act === 'delete') deleteBot(id);
        });

        document.getElementById('botsContainer').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && e.target && e.target.id && e.target.id.indexOf('cmd-') === 0) {
                sendCommand(parseInt(e.target.id.replace('cmd-', '')));
            }
        });

        async function sendCommand(botId) {
            var input = document.getElementById('cmd-' + botId);
            var command = input.value;
            if (!command) return;
            var res = await post('/api/bots/command', { botId: botId, command: command });
            var data = await res.json();
            if (!res.ok) alert(data.error);
            input.value = '';
            input.blur();
            loadBots();
        }

        async function toggleBot(botId, action) {
            await post('/api/bots/toggle', { botId: botId, action: action });
            loadBots();
        }

        async function deleteBot(botId) {
            if (!confirm('هل أنت متأكد من حذف هذا البوت؟')) return;
            await post('/api/bots/delete', { botId: botId });
            loadBots();
        }

        function openPromoModal() {
            document.getElementById('promoModal').classList.toggle('hidden');
        }

        async function redeemCode() {
            var code = document.getElementById('promoInput').value;
            var res = await post('/api/redeem', { code: code });
            var data = await res.json();
            if (res.ok) {
                alert(data.message);
                if (data.role === 'owner' || data.role === 'admin' || data.plan_type === 'lifetime') {
                    launchParticles('lifetime');
                } else if (data.duration_days >= 30) {
                    launchParticles('month');
                } else {
                    launchParticles('week');
                }
                document.getElementById('promoInput').value = '';
                fetchUser();
                openPromoModal();
            } else {
                alert(data.error);
            }
        }

        async function toggleAdminPanel() {
            var panel = document.getElementById('adminPanel');
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) {
                var res = await fetch('/api/admin/users');
                if (!res.ok) return;
                var users = await res.json();
                var list = document.getElementById('adminUsersList');
                list.innerHTML = users.map(function (u) {
                    return '<div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; padding:8px 0; border-bottom:1px solid rgba(168,85,247,0.2);">' +
                        '<span>ID: ' + u.id + ' | <b>' + esc(u.username) + '</b> (' + esc(u.email) + ')</span>' +
                        '<span>الرتبة: <b>' + esc(u.role) + '</b> | الباقة: <b>' + esc(u.plan) + '</b></span>' +
                    '</div>';
                }).join('');
            }
        }

        async function logout() {
            await fetch('/api/logout');
            location.reload();
        }

        fetchUser();
        setInterval(function () { if (currentUser) loadBots(); }, 4000);
    </script>
</body>
</html>`.split('__DEFAULT_NAME__').join(DEFAULT_BOT_NAME);

app.get('*', (req, res) => {
    res.send(PAGE_HTML);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Starting 1k Server running on port ${PORT}`));
