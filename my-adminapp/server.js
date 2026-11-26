const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
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

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + SESSION_SECRET).digest('hex');
}

// 4つのテーブルを自動作成（運営投稿・お問い合わせ・会員・会員投稿）
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        author_name VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
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

// 認証ミドルウェア
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect('/admin?error=unauthorized');
}
function requireAdminApi(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: '管理者認証が必要です' });
}
function requireUser(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/login?error=unauthorized');
}
function requireUserApi(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: '会員ログインが必要です' });
}

// ==========================================
// ▼ 画面ルート
// ==========================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'home.html')));
app.get('/news', (req, res) => res.sendFile(path.join(__dirname, 'public', 'news.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));
app.get('/community', (req, res) => res.sendFile(path.join(__dirname, 'public', 'community.html')));

app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/mypage');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/register', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/mypage');
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});
app.get('/mypage', requireUser, (req, res) => res.sendFile(path.join(__dirname, 'public', 'mypage.html')));

app.get('/admin', (req, res) => {
  if (req.session && req.session.isAdmin) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/dashboard', requireAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ==========================================
// ▼ 認証処理（会員・管理者）
// ==========================================

app.post('/user/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.redirect('/register?error=missing');
  try {
    const hashed = hashPassword(password);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [name, email, hashed]
    );
    req.session.user = result.rows[0];
    res.redirect('/mypage');
  } catch (err) {
    res.redirect('/register?error=exists');
  }
});

app.post('/user/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const hashed = hashPassword(password);
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE email = $1 AND password_hash = $2',
      [email, hashed]
    );
    if (result.rows.length > 0) {
      req.session.user = result.rows[0];
      return res.redirect('/mypage');
    }
    res.redirect('/login?error=invalid');
  } catch (err) {
    res.redirect('/login?error=invalid');
  }
});

app.post('/user/logout', (req, res) => {
  req.session.user = null;
  res.redirect('/');
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session ? req.session.user || null : null });
});

app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAdmin = true;
    return res.redirect('/dashboard');
  }
  res.redirect('/admin?error=invalid');
});

app.post('/admin/logout', (req, res) => {
  req.session.isAdmin = false;
  res.redirect('/admin');
});

// ==========================================
// ▼ 【新規】一般会員の投稿API
// ==========================================

// 1. 会員投稿の一覧取得（閲覧は誰でも可能）
app.get('/api/user-posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM user_posts ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '取得エラー' });
  }
});

// 2. 会員による新規投稿（ログイン済み会員のみ）
app.post('/api/user-posts', requireUserApi, async (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'タイトルと本文は必須です' });

  const user = req.session.user;
  try {
    const result = await pool.query(
      'INSERT INTO user_posts (user_id, author_name, title, content) VALUES ($1, $2, $3, $4) RETURNING *',
      [user.id, user.name, title, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: '投稿に失敗しました' });
  }
});

// 3. 会員投稿の削除（投稿者本人、または管理者のみ削除可能）
app.delete('/api/user-posts/:id', async (req, res) => {
  const postId = parseInt(req.params.id, 10);
  const user = req.session ? req.session.user : null;
  const isAdmin = req.session ? req.session.isAdmin : false;

  if (!user && !isAdmin) return res.status(401).json({ error: '権限がありません' });

  try {
    if (isAdmin) {
      await pool.query('DELETE FROM user_posts WHERE id = $1', [postId]);
    } else {
      await pool.query('DELETE FROM user_posts WHERE id = $1 AND user_id = $2', [postId, user.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '削除エラー' });
  }
});

// ==========================================
// ▼ 運営投稿・お問い合わせ・会員管理API
// ==========================================

app.get('/api/posts', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM posts ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '取得エラー' });
  }
});

app.post('/api/posts', requireAdminApi, async (req, res) => {
  const { title, category, content } = req.body;
  if (!title) return res.status(400).json({ error: 'タイトル必須' });
  try {
    const result = await pool.query(
      'INSERT INTO posts (category, title, content) VALUES ($1, $2, $3) RETURNING *',
      [category || '一般', title, content || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: '保存エラー' });
  }
});

app.delete('/api/posts/:id', requireAdminApi, async (req, res) => {
  try {
    await pool.query('DELETE FROM posts WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '削除エラー' });
  }
});

app.post('/api/inquiries', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: '必須項目不足' });
  try {
    await pool.query(
      'INSERT INTO inquiries (name, email, subject, message) VALUES ($1, $2, $3, $4)',
      [name, email, subject || '件名なし', message]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '送信エラー' });
  }
});

app.get('/api/inquiries', requireAdminApi, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM inquiries ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '取得エラー' });
  }
});

app.delete('/api/inquiries/:id', requireAdminApi, async (req, res) => {
  try {
    await pool.query('DELETE FROM inquiries WHERE id = $1', [parseInt(req.params.id, 10)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '削除エラー' });
  }
});

app.get('/api/users', requireAdminApi, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, email, created_at FROM users ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: '取得エラー' });
  }
});
app.delete('/api/users/:id', requireAdminApi, async (req, res) => {
try {
await pool.query('DELETE FROM users WHERE id = $1', [parseInt(req.params.id, 10)]);
res.json({ success: true });
} catch (err) {
res.status(500).json({ error: '削除エラー' });
}
});
app.listen(PORT, '0.0.0.0', () => {
console.log('erver is running on port' +{PORT});
});
