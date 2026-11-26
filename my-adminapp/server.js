const express = require('express');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'railway-secret-key-change-me';

// PostgreSQL接続設定
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('railway.internal')
    ? { rejectUnauthorized: false }
    : false
});

// 初回起動時にテーブルを自動作成する関数
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
    console.log('PostgreSQL table initialized');
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

// 認証チェック（画面用）
function requireAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) return next();
  res.redirect('/?error=unauthorized');
}

// 認証チェック（管理API用）
function requireApiAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) return next();
  res.status(401).json({ error: '認証が必要です' });
}

// ==========================================
// ▼ 画面ルート
// ==========================================

// 管理者ログイン画面
app.get('/', (req, res) => {
  if (req.session && req.session.isAuthenticated) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 管理者ダッシュボード（ログイン必須）
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// 【新規】誰でも見れる投稿公開画面
app.get('/news', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'news.html'));
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
// ▼ データベース連携API
// ==========================================

// 1. 投稿一覧を取得（公開画面・管理画面の両方から利用可能）
app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'データ取得に失敗しました' });
  }
});

// 2. 新規投稿を追加（管理者のみ）
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

// 3. 投稿を削除（管理者のみ）
app.delete('/api/posts/:id', requireApiAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM posts WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '削除に失敗しました' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
