const express = require('express');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'railway-secret-key-change-me';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('railway.internal')
    ? { rejectUnauthorized: false }
    : false
});

// 初回起動時に「投稿テーブル」と「お問い合わせテーブル」を自動作成
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        category VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inquiries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('PostgreSQL tables initialized');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}
initDB();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) return next();
  res.redirect('/?error=unauthorized');
}

function requireApiAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) return next();
  res.status(401).json({ error: '認証が必要です' });
}

// ==========================================
// ▼ 画面ルート
// ==========================================

app.get('/', (req, res) => {
  if (req.session && req.session.isAuthenticated) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/news', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'news.html'));
});

// 【新規】お問い合わせ画面
app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contact.html'));
});

// ==========================================
// ▼ 認証処理
// ==========================================

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAuthenticated = true;
    return res.redirect('/dashboard');
  }
  res.redirect('/?error=invalid');
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ==========================================
// ▼ 投稿管理API
// ==========================================

app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'データ取得に失敗しました' });
  }
});

app.post('/api/posts', requireApiAuth, async (req, res) => {
  const { title, category, content } = req.body;
  if (!title) return res.status(400).json({ error: 'タイトルは必須です' });

  try {
    const result = await pool.query(
      'INSERT INTO posts (category, title, content) VALUES ($1, $2, $3) RETURNING *',
      [category || '一般', title, content || '']
    );
    res.status(201).json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '保存に失敗しました' });
  }
});

app.delete('/api/posts/:id', requireApiAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM posts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

// ==========================================
// ▼ 【新規】お問い合わせAPI
// ==========================================

// 1. お問い合わせ送信（一般ユーザー誰でも送信可能）
app.post('/api/inquiries', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) {
    return res.status(400).json({ error: '必須項目を入力してください' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO inquiries (name, email, subject, message) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, email, subject || '件名なし', message]
    );
    res.status(201).json({ success: true, inquiry: result.rows });
  } catch (err) {
    res.status(500).json({ error: '送信に失敗しました' });
  }
});

// 2. お問い合わせ一覧取得（管理者のみ閲覧可能）
app.get('/api/inquiries', requireApiAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM inquiries ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '取得に失敗しました' });
  }
});

// 3. お問い合わせ削除（管理者のみ）
app.delete('/api/inquiries/:id', requireApiAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM inquiries WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
