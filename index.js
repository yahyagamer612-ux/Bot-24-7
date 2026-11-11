const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const mineflayer = require('mineflayer');
const http = require('http');

const app = express();
const server = http.createServer(app);

// اسم البوت الافتراضي للحسابات المجانية (ماينكرافت يسمح بحد أقصى 16 حرف)
const DEFAULT_BOT_NAME = 'sub_to_starting';

const SESSION_SECRET = process.env.SESSION_SECRET || 'change_this_secret_in_railway_variables';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'owner123';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DB_PATH = process.env.DB_PATH || './database.db';

if (!process.env.SESSION_SECRET) console.warn('تحذير: لم يتم ضبط SESSION_SECRET في المتغيرات.');
if (!process.env.OWNER_PASSWORD) console.warn('تحذير: لم يتم ضبط OWNER_PASSWORD، يتم استخدام الافتراضي.');

// منع سقوط السيرفر بسبب أخطاء غير متوقعة من مكتبة البوتات
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

// ----------------------------------------------------
// Database Setup & Initial Promo Codes
// ----------------------------------------------------
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
