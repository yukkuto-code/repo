const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
// Railwayが自動で割り当てるポート番号を使用
const PORT = process.env.PORT || 3000;

// 環境変数から認証情報を取得（未設定時のデフォルト値も用意）
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'password123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'railway-secret-key-change-me';

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// セッション設定
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 // 24時間有効
  }
}));

// 認証チェック用ミドルウェア
function requireAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) {
    return next();
  }
  res.redirect('/?error=unauthorized');
}

// ログイン画面の配信
app.get('/', (req, res) => {
  if (req.session && req.session.isAuthenticated) {
    return res.redirect('/dashboard');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ログイン処理（POST）
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.isAuthenticated = true;
    return res.redirect('/dashboard');
  }
  
  res.redirect('/?error=invalid');
});

// ログイン後の管理画面（認証必須）
app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ログアウト処理
app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
