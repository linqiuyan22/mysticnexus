// ============================================================
//  玄枢 · 云端服务 Worker v2（Cloudflare Workers + D1 SQLite）
//  由腾讯云云函数（PostgREST）全量迁移：账号 / 帖子 / 档案 / 头像 /
//  好友 / 好友申请 / 私信 / 聊天室 / 群聊 / 签到积分
//  部署：_deploy_upload/worker-deploy/ 目录下 `npx wrangler deploy`
//  D1 绑定变量名：HUAXU_DB（wrangler.toml 已配置）
// ============================================================
'use strict';

const INVITE_CODE = 'HX-2026';
const ADMIN_USERNAME = 'HUAXU';
const ADMIN_PASSWORD = 'hx1234';
const TOKEN_TTL_MS = 7 * 24 * 3600 * 1000; // 7 天
const STAFF_OPTIONS = {
  'L-09-01-S': '苏晚眠',
  'L-09-03-S': '沈绛离',
  'L-09-02-X': '谢逢虚',
  'L-09-04-W': '温泣语',
  'L-09-05-L': '陆烬弦'
};

// ---------- 建表（含 v1→v2 增量列迁移） ----------
async function ensureTables(env) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY, pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
      type TEXT NOT NULL, staff_id TEXT, role_name TEXT NOT NULL,
      avatar TEXT, is_admin INTEGER DEFAULT 0, created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS archives (
      id TEXT PRIMARY KEY, title TEXT, category TEXT, sub_category TEXT, tags TEXT,
      summary TEXT, content TEXT, image TEXT, subtitle TEXT, created_by TEXT, updated_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, title TEXT, content TEXT, board TEXT, author TEXT,
      author_username TEXT, author_avatar TEXT, image TEXT, timestamp TEXT, comments TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS friends (
      username TEXT NOT NULL, friend TEXT NOT NULL, PRIMARY KEY (username, friend)
    )`,
    `CREATE TABLE IF NOT EXISTS friend_requests (
      from_user TEXT NOT NULL, to_user TEXT NOT NULL, status TEXT, created_at INTEGER,
      PRIMARY KEY (from_user, to_user)
    )`,
    `CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, from_user TEXT, from_name TEXT, to_user TEXT, to_name TEXT, text TEXT, time TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS chat (
      id TEXT PRIMARY KEY, username TEXT, name TEXT, text TEXT, time TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS friend_groups (
      id TEXT PRIMARY KEY, name TEXT UNIQUE, members TEXT, owner TEXT, created_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS group_messages (
      id TEXT PRIMARY KEY, group_name TEXT, username TEXT, name TEXT, text TEXT, time TEXT
    )`
  ];
  for (const sql of tables) { await env.HUAXU_DB.prepare(sql).run(); }
  // v2 新增列（已存在则忽略报错）
  const alters = [
    `ALTER TABLE users ADD COLUMN nickname TEXT`,
    `ALTER TABLE users ADD COLUMN awakening_profile TEXT`,
    `ALTER TABLE users ADD COLUMN friend_notes TEXT`,
    `ALTER TABLE users ADD COLUMN points INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN checkin_streak INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN checkin_total INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN checkin_points INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN checkin_last_date TEXT`,
    `ALTER TABLE users ADD COLUMN checkin_dates TEXT`
  ];
  for (const sql of alters) { try { await env.HUAXU_DB.prepare(sql).run(); } catch (e) { /* 列已存在 */ } }
}

// ---------- 工具 ----------
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  });
}
function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return bytesToHex(a);
}
async function hashPassword(pass, saltHex) {
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return bytesToHex(bits);
}
function parseJSON(v, fallback) {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}
const NICK_A = ['夜行客','雾中客','纸灯人','烛火客','檐下人','巷口客','旧伞客','星辉客','无眠客','潮声客','槐下客','墨夜客','拾影人','望月人','叩门人','提灯客','枕风客','听雨人','守夜人','引路人'];
function genNick() {
  return NICK_A[Math.floor(Math.random() * NICK_A.length)] + '_' + Math.floor(Math.random() * 0xfff).toString(16);
}
function publicUser(u) {
  return {
    username: u.username,
    staffId: u.staff_id || null,
    roleName: u.role_name || '游客',
    nickname: u.nickname || null,
    type: u.type || 'guest',
    avatar: u.avatar || null,
    isAdmin: !!u.is_admin,
    createdAt: u.created_at || null
  };
}
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function normGroupMembers(v) {
  const p = parseJSON(v, []);
  return Array.isArray(p) ? p.map(String) : [];
}

// ---------- 认证 ----------
function getToken(request, url) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const xt = request.headers.get('x-token');
  if (xt) return xt.trim();
  return (url && url.searchParams.get('token')) || '';
}
async function findUser(env, uname) {
  return await env.HUAXU_DB.prepare('SELECT * FROM users WHERE username = ?').bind(uname).first();
}
async function readSession(env, token) {
  if (!token) return null;
  const sess = await env.HUAXU_DB.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first();
  if (!sess) return null;
  if (Date.now() > sess.expires) {
    await env.HUAXU_DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return sess;
}
async function createSession(env, username) {
  const token = randomHex(32);
  await env.HUAXU_DB.prepare('INSERT INTO sessions (token, username, expires) VALUES (?,?,?)')
    .bind(token, username, Date.now() + TOKEN_TTL_MS).run();
  return token;
}
async function requireAuth(request, env, url) {
  const token = getToken(request, url);
  if (!token) return null;
  const sess = await readSession(env, token);
  if (!sess) return null;
  const u = await findUser(env, sess.username);
  if (!u) return null;
  return { username: u.username, user: u, displayName: u.role_name || u.username };
}

// ---------- 注册 ----------
async function handleRegister(body, env) {
  const { invite, username, pass, roleType, roleName, staffId, avatar, awakening } = body || {};
  if (invite !== INVITE_CODE) return json({ error: '邀请码错误' }, 400);
  const uname = String(username || '').trim();
  const pwd = String(pass || '');
  if (uname.length < 2 || uname.length > 20) return json({ error: '用户名需 2-20 个字符' }, 400);
  if (pwd.length < 6) return json({ error: '密码至少 6 位' }, 400);
  if (!/^[\w\u4e00-\u9fa5]{2,20}$/.test(uname)) return json({ error: '用户名仅限中英文、数字、下划线' }, 400);

  const dup = await findUser(env, uname);
  if (dup) return json({ error: '用户名已被占用' }, 409);

  let type = 'guest', finalRole = '游客', finalStaff = null, awProfile = null;
  if (roleType === 'self') {
    type = 'staff';
    finalRole = String(roleName || uname).trim().slice(0, 12) || uname;
  } else if (roleType === 'awakened') {
    type = 'awakened';
    finalRole = String(roleName || uname).trim().slice(0, 12) || uname;
    if (awakening && typeof awakening === 'object') awProfile = awakening;
  } else if (roleType === 'staff') {
    if (!STAFF_OPTIONS[staffId]) return json({ error: '无效的职员编号' }, 400);
    type = 'staff';
    finalRole = STAFF_OPTIONS[staffId];
    finalStaff = staffId;
  } else if (roleName && String(roleName).trim()) {
    finalRole = String(roleName).trim().slice(0, 12);
  }

  const salt = randomHex(16);
  const hash = await hashPassword(pwd, salt);
  const now = Date.now();
  const isAdmin = uname.toUpperCase() === ADMIN_USERNAME && pwd === ADMIN_PASSWORD;
  const nickname = genNick();

  await env.HUAXU_DB.prepare(
    `INSERT INTO users (username, pass_hash, salt, type, staff_id, role_name, nickname, avatar, is_admin, created_at, awakening_profile)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(uname, hash, salt, type, finalStaff, finalRole, nickname, avatar || '👤', isAdmin ? 1 : 0, now, awProfile ? JSON.stringify(awProfile) : null).run();

  const token = await createSession(env, uname);
  return json({
    token,
    user: { username: uname, roleName: finalRole, nickname, type, staffId: finalStaff, avatar: avatar || '👤', isAdmin, createdAt: now }
  });
}

// ---------- 登录 ----------
async function handleLogin(body, env) {
  const { username, pass } = body || {};
  const uname = String(username || '').trim();
  const pwd = String(pass || '');
  if (!uname || !pwd) return json({ error: '[!] 用户名或密码错误' }, 401);

  let u = await findUser(env, uname);

  // 管理员首次登录自动播种（users 表里没有 HUAXU 时）
  if (!u && uname === ADMIN_USERNAME) {
    if (pwd !== ADMIN_PASSWORD) return json({ error: '[!] 用户名或密码错误' }, 401);
    const salt = randomHex(16);
    const hash = await hashPassword(pwd, salt);
    const createdAt = Date.now();
    await env.HUAXU_DB.prepare(
      `INSERT INTO users (username, pass_hash, salt, type, staff_id, role_name, nickname, avatar, is_admin, created_at)
       VALUES (?,?,?,?,?,?,?,?,1,?)`
    ).bind(uname, hash, salt, 'staff', uname, '系统管理员', genNick(), null, createdAt).run();
    u = await findUser(env, uname);
  }

  if (!u) return json({ error: '[!] 用户名或密码错误' }, 401);
  const hash = await hashPassword(pwd, u.salt);
  if (hash !== u.pass_hash) return json({ error: '[!] 用户名或密码错误' }, 401);

  const token = await createSession(env, u.username);
  return json({ token, user: publicUser(u) });
}

async function handleMe(request, env, url) {
  const auth = await requireAuth(request, env, url);
  if (!auth) return json({ error: '未登录或会话已过期' }, 401);
  return json({ user: publicUser(auth.user) });
}
async function handleLogout(request, env, url) {
  const token = getToken(request, url);
  if (token) { try { await env.HUAXU_DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run(); } catch (e) {} }
  return json({ ok: true });
}

// ---------- 档案 ----------
async function handleGetArchives(env) {
  const { results } = await env.HUAXU_DB.prepare('SELECT * FROM archives LIMIT 1000').all();
  const archives = (results || []).map(a => ({
    id: a.id, title: a.title, category: a.category,
    subCategory: a.sub_category || null, tags: parseJSON(a.tags, []),
    summary: a.summary, content: a.content, image: a.image || null,
    subtitle: a.subtitle || null, created_by: a.created_by, updated_at: a.updated_at
  }));
  return json({ archives });
}
async function handleSaveArchive(body, auth, env) {
  const id = String((body || {}).id || '').trim();
  if (!id) return json({ error: '档案编号不能为空' }, 400);
  const title = String(body.title || '').trim();
  const content = String(body.content || '').trim();
  if (!title || !content) return json({ error: '标题与内容不能为空' }, 400);
  const archive = {
    id, title,
    category: String(body.category || '华墟管理档案').trim(),
    subCategory: body.subCategory || null,
    tags: Array.isArray(body.tags) ? body.tags : [],
    summary: String(body.summary || '').trim(),
    content,
    image: body.image || null,
    subtitle: body.subtitle || null,
    created_by: auth.username,
    updated_at: Date.now()
  };
  const existing = await env.HUAXU_DB.prepare('SELECT id FROM archives WHERE id = ?').bind(id).first();
  if (existing) {
    await env.HUAXU_DB.prepare(
      `UPDATE archives SET title=?, category=?, sub_category=?, tags=?, summary=?, content=?, image=?, subtitle=?, created_by=?, updated_at=? WHERE id=?`
    ).bind(archive.title, archive.category, archive.subCategory, JSON.stringify(archive.tags), archive.summary, archive.content, archive.image, archive.subtitle, archive.created_by, archive.updated_at, id).run();
  } else {
    await env.HUAXU_DB.prepare(
      `INSERT INTO archives (id, title, category, sub_category, tags, summary, content, image, subtitle, created_by, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(archive.id, archive.title, archive.category, archive.subCategory, JSON.stringify(archive.tags), archive.summary, archive.content, archive.image, archive.subtitle, archive.created_by, archive.updated_at).run();
  }
  return json({ archive });
}
async function handleDeleteArchive(body, auth, env) {
  const id = String((body || {}).id || '');
  if (!id) return json({ error: '档案编号不能为空' }, 400);
  const a = await env.HUAXU_DB.prepare('SELECT * FROM archives WHERE id = ?').bind(id).first();
  if (!a) return json({ error: '档案不存在' }, 404);
  if (a.created_by !== auth.username && !auth.user.is_admin) return json({ error: '无权操作' }, 403);
  await env.HUAXU_DB.prepare('DELETE FROM archives WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// ---------- 帖子 ----------
async function handleGetPosts(env) {
  const { results } = await env.HUAXU_DB.prepare('SELECT * FROM posts ORDER BY timestamp DESC LIMIT 500').all();
  const posts = (results || []).map(p => ({
    id: p.id, title: p.title, content: p.content, board: p.board,
    author: p.author, author_username: p.author_username,
    author_avatar: p.author_avatar || null, image: p.image || null,
    timestamp: p.timestamp, comments: parseJSON(p.comments, [])
  }));
  return json({ posts });
}
async function handleCreatePost(body, auth, env) {
  const title = String((body || {}).title || '').trim();
  const content = String(body.content || '').trim();
  const board = String(body.board || '综合').trim();
  if (!title) return json({ error: '标题不能为空' }, 400);
  if (!content) return json({ error: '内容不能为空' }, 400);
  let id = String(body.id || '').trim();
  if (id) {
    const dup = await env.HUAXU_DB.prepare('SELECT id FROM posts WHERE id = ?').bind(id).first();
    if (dup) return json({ error: '帖子已存在' }, 409);
  } else {
    id = 'p' + Date.now() + Math.floor(Math.random() * 900);
  }
  const comments = Array.isArray(body.comments) ? body.comments : [];
  const post = {
    id, title, content, board,
    author: String(body.author || auth.displayName),
    author_username: body.author_username || auth.username,
    author_avatar: body.author_avatar || null,
    image: body.image || null,
    timestamp: body.timestamp || new Date().toLocaleString('zh-CN'),
    comments
  };
  await env.HUAXU_DB.prepare(
    `INSERT INTO posts (id, title, content, board, author, author_username, author_avatar, image, timestamp, comments)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(post.id, post.title, post.content, post.board, post.author, post.author_username, post.author_avatar, post.image, post.timestamp, JSON.stringify(comments)).run();
  return json({ post });
}
async function handleUpdatePost(body, auth, env) {
  const id = String((body || {}).id || '');
  const post = await env.HUAXU_DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
  if (!post) return json({ error: '帖子不存在' }, 404);
  if (post.author_username !== auth.username && !auth.user.is_admin) return json({ error: '无权操作' }, 403);
  const title = body.title !== undefined ? (String(body.title).trim() || post.title) : post.title;
  const content = body.content !== undefined ? String(body.content) : post.content;
  const board = body.board !== undefined ? String(body.board) : post.board;
  await env.HUAXU_DB.prepare('UPDATE posts SET title=?, content=?, board=? WHERE id=?').bind(title, content, board, id).run();
  return json({ ok: true });
}
async function handleDeletePost(body, auth, env) {
  const id = String((body || {}).id || '');
  const post = await env.HUAXU_DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
  if (!post) return json({ error: '帖子不存在' }, 404);
  if (post.author_username !== auth.username && !auth.user.is_admin) return json({ error: '无权操作' }, 403);
  await env.HUAXU_DB.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
async function handleAddComment(body, auth, env) {
  const postId = String((body || {}).postId || '');
  const text = String(body.text || '').trim();
  if (!postId || !text) return json({ error: '参数缺失' }, 400);
  const post = await env.HUAXU_DB.prepare('SELECT * FROM posts WHERE id = ?').bind(postId).first();
  if (!post) return json({ error: '帖子不存在' }, 404);
  const comments = parseJSON(post.comments, []);
  comments.push({
    user: String(body.user || auth.displayName),
    username: auth.username,
    avatar: body.avatar || null,
    text,
    time: new Date().toLocaleString('zh-CN'),
    likes: 0,
    replyTo: body.replyTo || null,
    floor: comments.length + 2
  });
  await env.HUAXU_DB.prepare('UPDATE posts SET comments=? WHERE id=?').bind(JSON.stringify(comments), postId).run();
  return json({ comments });
}

// ---------- 头像 ----------
async function handleAvatar(body, auth, env) {
  const avatar = String((body || {}).avatar || '').slice(0, 500000);
  if (!avatar) return json({ error: '头像不能为空' }, 400);
  await env.HUAXU_DB.prepare('UPDATE users SET avatar=? WHERE username=?').bind(avatar, auth.username).run();
  return json({ avatar });
}

// ---------- 好友 ----------
async function handleGetFriends(auth, env) {
  const { results } = await env.HUAXU_DB.prepare('SELECT friend FROM friends WHERE username = ?').bind(auth.username).all();
  const notes = parseJSON(auth.user.friend_notes, {}) || {};
  return json({ friends: (results || []).map(r => r.friend), notes });
}
async function handleAddFriend(body, auth, env) {
  const friend = String((body || {}).friend || '').trim();
  if (!friend) return json({ error: '好友名不能为空' }, 400);
  if (friend === auth.username) return json({ error: '不能添加自己' }, 400);
  const existing = await env.HUAXU_DB.prepare('SELECT friend FROM friends WHERE username=? AND friend=?').bind(auth.username, friend).first();
  if (existing) return json({ error: '已是好友' }, 409);
  await env.HUAXU_DB.prepare('INSERT INTO friends (username, friend) VALUES (?,?)').bind(auth.username, friend).run();
  return json({ ok: true });
}
async function handleRemoveFriend(body, auth, env) {
  const friend = String((body || {}).friend || '');
  if (!friend) return json({ error: '参数缺失' }, 400);
  await env.HUAXU_DB.prepare('DELETE FROM friends WHERE username=? AND friend=?').bind(auth.username, friend).run();
  await env.HUAXU_DB.prepare('DELETE FROM friends WHERE username=? AND friend=?').bind(friend, auth.username).run();
  return json({ ok: true });
}
async function handleGetFriendRequests(auth, env) {
  const got = await env.HUAXU_DB.prepare('SELECT from_user, to_user, status, created_at FROM friend_requests WHERE to_user=? ORDER BY created_at DESC LIMIT 50').bind(auth.username).all();
  const sent = await env.HUAXU_DB.prepare('SELECT from_user, to_user, status, created_at FROM friend_requests WHERE from_user=? ORDER BY created_at DESC LIMIT 50').bind(auth.username).all();
  return json({ requests: [...(got.results || []), ...(sent.results || [])] });
}
async function handleSendFriendRequest(body, auth, env) {
  const to = String((body || {}).to || '').trim();
  if (!to) return json({ error: '对方用户名不能为空' }, 400);
  if (to === auth.username) return json({ error: '不能添加自己' }, 400);
  const exist = await env.HUAXU_DB.prepare('SELECT friend FROM friends WHERE username=? AND friend=?').bind(auth.username, to).first();
  if (exist) return json({ error: '已是好友' }, 409);
  const pending = await env.HUAXU_DB.prepare("SELECT from_user FROM friend_requests WHERE from_user=? AND to_user=? AND status='pending'").bind(auth.username, to).first();
  if (pending) return json({ error: '已发送过申请，等待对方处理' }, 409);
  const target = await env.HUAXU_DB.prepare('SELECT username FROM users WHERE username=?').bind(to).first();
  if (!target) return json({ error: '用户不存在' }, 404);
  await env.HUAXU_DB.prepare('INSERT INTO friend_requests (from_user, to_user, status, created_at) VALUES (?,?,?,?)').bind(auth.username, to, 'pending', Date.now()).run();
  return json({ ok: true });
}
async function handleAcceptFriend(body, auth, env) {
  const from = String((body || {}).from || '').trim();
  if (!from) return json({ error: '参数缺失' }, 400);
  await env.HUAXU_DB.prepare('DELETE FROM friend_requests WHERE from_user=? AND to_user=?').bind(from, auth.username).run();
  const a1 = await env.HUAXU_DB.prepare('SELECT friend FROM friends WHERE username=? AND friend=?').bind(auth.username, from).first();
  if (!a1) await env.HUAXU_DB.prepare('INSERT INTO friends (username, friend) VALUES (?,?)').bind(auth.username, from).run();
  const a2 = await env.HUAXU_DB.prepare('SELECT friend FROM friends WHERE username=? AND friend=?').bind(from, auth.username).first();
  if (!a2) await env.HUAXU_DB.prepare('INSERT INTO friends (username, friend) VALUES (?,?)').bind(from, auth.username).run();
  return json({ ok: true });
}
async function handleDeclineFriend(body, auth, env) {
  const from = String((body || {}).from || '').trim();
  if (!from) return json({ error: '参数缺失' }, 400);
  await env.HUAXU_DB.prepare('DELETE FROM friend_requests WHERE from_user=? AND to_user=?').bind(from, auth.username).run();
  return json({ ok: true });
}
async function handleFriendNote(body, auth, env) {
  const friend = String((body || {}).friend || '').trim();
  const note = String(body.note || '').trim();
  if (!friend) return json({ error: '参数缺失' }, 400);
  const notes = parseJSON(auth.user.friend_notes, {}) || {};
  notes[friend] = note || null;
  await env.HUAXU_DB.prepare('UPDATE users SET friend_notes=? WHERE username=?').bind(JSON.stringify(notes), auth.username).run();
  return json({ ok: true });
}

// ---------- 私信 ----------
async function handleGetMessages(auth, env) {
  const { results } = await env.HUAXU_DB.prepare('SELECT * FROM messages WHERE from_user=? OR to_user=? ORDER BY time ASC LIMIT 300').bind(auth.username, auth.username).all();
  return json({ messages: results || [] });
}
async function handleSendMessage(body, auth, env) {
  const to = String((body || {}).to || '').trim();
  const text = String(body.text || '').trim();
  if (!to || !text) return json({ error: '参数缺失' }, 400);
  const id = 'm' + Date.now() + Math.floor(Math.random() * 900);
  const msg = { id, from_user: auth.username, from_name: auth.displayName, to_user: to, to_name: to, text, time: new Date().toLocaleString('zh-CN') };
  await env.HUAXU_DB.prepare('INSERT INTO messages (id, from_user, from_name, to_user, to_name, text, time) VALUES (?,?,?,?,?,?,?)')
    .bind(msg.id, msg.from_user, msg.from_name, msg.to_user, msg.to_name, msg.text, msg.time).run();
  return json({ message: msg });
}

// ---------- 在线用户 ----------
async function handleGetUsers(env) {
  const { results } = await env.HUAXU_DB.prepare('SELECT username, role_name, nickname, avatar, created_at FROM users LIMIT 500').all();
  return json({ users: (results || []).map(u => ({ username: u.username, roleName: u.role_name || u.username, nickname: u.nickname || null, avatar: u.avatar || null, createdAt: u.created_at })) });
}

// ---------- 签到 + 积分 ----------
async function handleGetProfile(auth) {
  const u = auth.user;
  const dates = parseJSON(u.checkin_dates, []);
  return json({
    points: Number(u.points) || 0,
    checkin: {
      streak: Number(u.checkin_streak) || 0,
      total: Number(u.checkin_total) || 0,
      points: Number(u.checkin_points) || 0,
      lastDate: u.checkin_last_date || null,
      dates: Array.isArray(dates) ? dates : []
    }
  });
}
async function handleCheckin(auth, env) {
  const u = auth.user;
  const today = todayStr();
  const yst = yesterdayStr();
  let streak = Number(u.checkin_streak) || 0;
  let total = Number(u.checkin_total) || 0;
  let checkinPoints = Number(u.checkin_points) || 0;
  let points = Number(u.points) || 0;
  let dates = parseJSON(u.checkin_dates, []);
  if (!Array.isArray(dates)) dates = [];
  const lastDate = u.checkin_last_date || null;
  if (lastDate === today) return json({ error: '今日已签到' }, 400);
  if (lastDate === yst) streak += 1; else streak = 1;
  total += 1;
  const gained = 10 + Math.min(20, (streak - 1) * 2);
  checkinPoints += gained;
  points += gained;
  dates = dates.slice(-60);
  dates.push(today);
  await env.HUAXU_DB.prepare(
    'UPDATE users SET checkin_streak=?, checkin_total=?, checkin_points=?, checkin_last_date=?, checkin_dates=?, points=? WHERE username=?'
  ).bind(streak, total, checkinPoints, today, JSON.stringify(dates), points, auth.username).run();
  return json({ gained, points, checkin: { streak, total, points: checkinPoints, lastDate: today, dates } });
}
async function handleAdjustPoints(body, auth, env) {
  const delta = Math.round(Number((body || {}).delta) || 0);
  if (!delta) return json({ error: '参数缺失' }, 400);
  let points = Number(auth.user.points) || 0;
  points = Math.max(0, points + delta);
  await env.HUAXU_DB.prepare('UPDATE users SET points=? WHERE username=?').bind(points, auth.username).run();
  return json({ points });
}

// ---------- 聊天室（大厅） ----------
async function handleGetChat(env) {
  const { results } = await env.HUAXU_DB.prepare('SELECT * FROM chat ORDER BY time DESC LIMIT 60').all();
  return json({ messages: (results || []).reverse() });
}
async function handleSendChat(body, auth, env) {
  const text = String((body || {}).text || '').trim();
  if (!text) return json({ error: '内容不能为空' }, 400);
  const id = 'c' + Date.now() + Math.floor(Math.random() * 900);
  const msg = { id, username: auth.username, name: auth.displayName, text, time: new Date().toLocaleString('zh-CN') };
  await env.HUAXU_DB.prepare('INSERT INTO chat (id, username, name, text, time) VALUES (?,?,?,?,?)')
    .bind(msg.id, msg.username, msg.name, msg.text, msg.time).run();
  return json({ message: msg });
}

// ---------- 群聊 ----------
async function handleGetGroups(auth, env) {
  const { results } = await env.HUAXU_DB.prepare('SELECT * FROM friend_groups LIMIT 500').all();
  const mine = (results || []).filter(g => normGroupMembers(g.members).indexOf(auth.username) !== -1);
  return json({ groups: mine.map(g => ({ name: g.name, members: normGroupMembers(g.members), owner: g.owner, createdAt: g.created_at })) });
}
async function handleCreateGroup(body, auth, env) {
  const name = String((body || {}).name || '').trim();
  if (!name) return json({ error: '群聊名不能为空' }, 400);
  if (name.length > 20) return json({ error: '群聊名不能超过 20 字' }, 400);
  const dup = await env.HUAXU_DB.prepare('SELECT name FROM friend_groups WHERE name=?').bind(name).first();
  if (dup) return json({ error: '群聊已存在' }, 409);
  let members = Array.isArray(body.members) ? body.members.map(String) : [];
  members = members.filter((m, i) => members.indexOf(m) === i);
  if (members.indexOf(auth.username) === -1) members.push(auth.username);
  const id = 'g' + Date.now() + Math.floor(Math.random() * 900);
  const createdAt = Date.now();
  await env.HUAXU_DB.prepare('INSERT INTO friend_groups (id, name, members, owner, created_at) VALUES (?,?,?,?,?)')
    .bind(id, name, JSON.stringify(members), auth.username, createdAt).run();
  return json({ group: { name, members, owner: auth.username, createdAt } });
}
async function handleGroupHistory(body, auth, env) {
  const name = String((body || {}).name || '').trim();
  if (!name) return json({ error: '参数缺失' }, 400);
  const group = await env.HUAXU_DB.prepare('SELECT * FROM friend_groups WHERE name=?').bind(name).first();
  if (!group) return json({ error: '群聊不存在' }, 404);
  if (normGroupMembers(group.members).indexOf(auth.username) === -1) return json({ error: '无权限' }, 403);
  const { results } = await env.HUAXU_DB.prepare('SELECT * FROM group_messages WHERE group_name=? ORDER BY time ASC LIMIT 300').bind(name).all();
  return json({ messages: results || [] });
}
async function handleSendGroupMessage(body, auth, env) {
  const name = String((body || {}).name || '').trim();
  const text = String(body.text || '').trim();
  if (!name || !text) return json({ error: '参数缺失' }, 400);
  const group = await env.HUAXU_DB.prepare('SELECT * FROM friend_groups WHERE name=?').bind(name).first();
  if (!group) return json({ error: '群聊不存在' }, 404);
  if (normGroupMembers(group.members).indexOf(auth.username) === -1) return json({ error: '无权限' }, 403);
  const id = 'gm' + Date.now() + Math.floor(Math.random() * 900);
  const msg = { id, group_name: name, username: auth.username, name: auth.displayName, text, time: new Date().toLocaleString('zh-CN') };
  await env.HUAXU_DB.prepare('INSERT INTO group_messages (id, group_name, username, name, text, time) VALUES (?,?,?,?,?,?)')
    .bind(msg.id, msg.group_name, msg.username, msg.name, msg.text, msg.time).run();
  return json({ message: msg });
}
async function handleDeleteGroup(body, auth, env) {
  const name = String((body || {}).name || '').trim();
  if (!name) return json({ error: '参数缺失' }, 400);
  const group = await env.HUAXU_DB.prepare('SELECT * FROM friend_groups WHERE name=?').bind(name).first();
  if (!group) return json({ error: '群聊不存在' }, 404);
  if (group.owner !== auth.username) return json({ error: '仅群主可删除' }, 403);
  await env.HUAXU_DB.prepare('DELETE FROM friend_groups WHERE name=?').bind(name).run();
  await env.HUAXU_DB.prepare('DELETE FROM group_messages WHERE group_name=?').bind(name).run();
  return json({ ok: true });
}
async function handleLeaveGroup(body, auth, env) {
  const name = String((body || {}).name || '').trim();
  if (!name) return json({ error: '参数缺失' }, 400);
  const group = await env.HUAXU_DB.prepare('SELECT * FROM friend_groups WHERE name=?').bind(name).first();
  if (!group) return json({ error: '群聊不存在' }, 404);
  const members = normGroupMembers(group.members);
  if (members.indexOf(auth.username) === -1) return json({ error: '你不在该群' }, 403);
  if (group.owner === auth.username || members.length <= 1) {
    await env.HUAXU_DB.prepare('DELETE FROM friend_groups WHERE name=?').bind(name).run();
    await env.HUAXU_DB.prepare('DELETE FROM group_messages WHERE group_name=?').bind(name).run();
    return json({ ok: true, deleted: true });
  }
  const newMembers = members.filter(m => m !== auth.username);
  await env.HUAXU_DB.prepare('UPDATE friend_groups SET members=? WHERE name=?').bind(JSON.stringify(newMembers), name).run();
  return json({ ok: true, deleted: false, members: newMembers });
}

// ---------- 路由 ----------
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const method = request.method.toUpperCase();

    let body = {};
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      body = await request.json().catch(() => ({}));
    }

    try {
      await ensureTables(env);

      // 账号
      if (path === '/api/health') return json({ ok: true, serverTime: Date.now() });
      if (path === '/api/register' && method === 'POST') return await handleRegister(body, env);
      if (path === '/api/login' && method === 'POST') return await handleLogin(body, env);
      if (path === '/api/logout' && method === 'POST') return await handleLogout(request, env, url);
      if (path === '/api/me' && method === 'GET') return await handleMe(request, env, url);

      // 帖子（GET 游客可见）
      if (path === '/api/posts' && method === 'GET') return await handleGetPosts(env);
      if (path === '/api/posts' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleCreatePost(body, a, env); }
      if (path === '/api/posts' && method === 'PUT') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleUpdatePost(body, a, env); }
      if (path === '/api/posts' && method === 'DELETE') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleDeletePost(body, a, env); }
      if (path === '/api/posts/comment' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleAddComment(body, a, env); }

      // 档案（GET 游客可见）
      if (path === '/api/archives' && method === 'GET') return await handleGetArchives(env);
      if (path === '/api/archives' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleSaveArchive(body, a, env); }
      if (path === '/api/archives' && method === 'DELETE') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleDeleteArchive(body, a, env); }

      // 头像 / 好友 / 私信 / 聊天室 / 群聊 / 用户 / 签到积分
      if (path === '/api/avatar' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleAvatar(body, a, env); }
      if (path === '/api/friends' && method === 'GET') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleGetFriends(a, env); }
      if (path === '/api/friends' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleAddFriend(body, a, env); }
      if (path === '/api/friends' && method === 'DELETE') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleRemoveFriend(body, a, env); }
      if (path === '/api/friends/note' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleFriendNote(body, a, env); }
      if (path === '/api/friend_requests' && method === 'GET') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleGetFriendRequests(a, env); }
      if (path === '/api/friend_requests' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleSendFriendRequest(body, a, env); }
      if (path === '/api/friend_requests/accept' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleAcceptFriend(body, a, env); }
      if (path === '/api/friend_requests/decline' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleDeclineFriend(body, a, env); }
      if (path === '/api/messages' && method === 'GET') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleGetMessages(a, env); }
      if (path === '/api/messages' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleSendMessage(body, a, env); }
      if (path === '/api/chat' && method === 'GET') return await handleGetChat(env);
      if (path === '/api/chat' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleSendChat(body, a, env); }
      if (path === '/api/groups' && method === 'GET') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleGetGroups(a, env); }
      if (path === '/api/groups' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleCreateGroup(body, a, env); }
      if (path === '/api/groups' && method === 'DELETE') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleDeleteGroup(body, a, env); }
      if (path === '/api/groups/leave' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleLeaveGroup(body, a, env); }
      if (path === '/api/groups/history' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleGroupHistory(body, a, env); }
      if (path === '/api/groups/messages' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleSendGroupMessage(body, a, env); }
      if (path === '/api/users' && method === 'GET') return await handleGetUsers(env);
      if (path === '/api/profile' && method === 'GET') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleGetProfile(a); }
      if (path === '/api/checkin' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleCheckin(a, env); }
      if (path === '/api/points' && method === 'POST') { const a = await requireAuth(request, env, url); if (!a) return json({ error: '未登录' }, 401); return await handleAdjustPoints(body, a, env); }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: '服务器错误: ' + (e && e.message ? e.message : e) }, 500);
    }
  }
};
