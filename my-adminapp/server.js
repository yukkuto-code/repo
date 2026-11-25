const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'railway-secret-key-change-me';

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
  if (req.session && req.session.isAuthenticated) {
    return next();
  }
  res.redirect('/?error=unauthorized');
}

// 認証チェック（API通信用）
function requireApiAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) {
    return next();
  }
  res.status(401).json({ error: '認証が必要です' });
}

// ▼ サーバー側で保持する仮データ（裏側のデータベース代わり）
let items = [
  { id: 1, title: 'システムメンテナンスのお知らせ', category: '重要', date: '2026-11-26' },
  { id: 2, title: '新規ユーザー登録機能のリリース', category: 'アップデート', date: '2026-11-25' }
];
let nextId = 3;

// ログイン画面
app.get('/', (req, res) => {
  if (req.session && req.session.isAuthenticated) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ログイン処理
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAuthenticated = true;
    return res.redirect('/dashboard');
  }
  res.redirect('/?error=invalid');
});

// 管理画面の配信
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ログアウト処理
app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ==========================================
// ▼ 裏の動き（フロントエンドと通信するAPI）
// ==========================================

// 1. データ一覧を取得する
app.get('/api/items', requireApiAuth, (req, res) => {
  res.json(items);
});

// 2. 新しいデータを追加する
app.post('/api/items', requireApiAuth, (req, res) => {
  const { title, category } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'タイトルは必須です' });
  }
  const today = new Date().toISOString().split('T')[0];
  const newItem = { id: nextId++, title, category: category || '一般', date: today };
  items.unshift(newItem); // 先頭に追加
  res.status(201).json(newItem);
});

// 3. データを削除する
app.delete('/api/items/:id', requireApiAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  items = items.filter(item => item.id !== id);
  res.json({ success: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
