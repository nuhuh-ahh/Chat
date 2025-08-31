import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import http from "http";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import mime from "mime-types";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { db, initDb, sql } from "./sqlite.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const PORT = process.env.PORT || 3000;

await initDb();

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: null }
});

app.use(sessionMiddleware);
io.engine.use((req, res, next) => sessionMiddleware(req, res, next));

app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ---------- Multer setup ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
  filename: (req, file, cb) => {
    const id = uuidv4();
    const ext = mime.extension(file.mimetype) || path.extname(file.originalname);
    const safeBase = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${id}__${safeBase}`);
  }
});
const upload = multer({ storage });

// ---------- Helpers ----------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}

function currentUser(req) {
  if (!req.session.user) return null;
  const user = db.prepare("SELECT id, username, avatar_url, bio FROM users WHERE id = ?").get(req.session.user.id);
  return user || null;
}

function or_undefined(v) { return v === undefined ? undefined : v; }

// ---------- Auth ----------
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "username and password required" });
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) return res.status(409).json({ error: "Username already taken" });

  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
  req.session.user = { id: info.lastInsertRowid, username };
  res.json({ ok: true });
});

app.post("/api/login", async (req, res) => {
  const { username, password, remember } = req.body;
  if (!username || !password) return res.status(400).json({ error: "username and password required" });
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!row) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  req.session.user = { id: row.id, username: row.username };
  if (remember) req.session.cookie.maxAge = 1000*60*60*24*30;
  else req.session.cookie.expires = false;
  res.json({ ok: true });
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/me", (req, res) => res.json({ user: currentUser(req) }));

// ---------- Settings ----------
app.post("/api/settings/profile", requireAuth, (req, res) => {
  const { username, bio, avatar_url } = req.body;
  if (username) {
    const exists = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(username, req.session.user.id);
    if (exists) return res.status(409).json({ error: "Username already in use" });
  }
  db.prepare("UPDATE users SET username = COALESCE(?, username), bio = COALESCE(?, bio), avatar_url = COALESCE(?, avatar_url) WHERE id = ?")
    .run(username || null, bio || null, avatar_url || null, req.session.user.id);
  if (username) req.session.user.username = username;
  res.json({ ok: true });
});

// ---------- Friends ----------
app.post("/api/friends/add", requireAuth, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "username required" });
  const target = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.id === req.session.user.id) return res.status(400).json({ error: "Cannot add yourself" });

  const existing = db.prepare("SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)")
    .get(req.session.user.id, target.id, target.id, req.session.user.id);
  if (existing) return res.status(409).json({ error: "Already friends or pending" });

  db.prepare("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)").run(req.session.user.id, target.id, "accepted");
  db.prepare("INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, ?)").run(target.id, req.session.user.id, "accepted");
  res.json({ ok: true });
});

app.get("/api/friends/list", requireAuth, (req, res) => {
  const list = db.prepare("SELECT u.id, u.username, u.avatar_url FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? AND f.status = 'accepted'").all(req.session.user.id);
  res.json({ friends: list });
});

// ---------- Groups & Channels ----------
app.post("/api/groups/create", requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const info = db.prepare("INSERT INTO groups (name, owner_id) VALUES (?, ?)").run(name, req.session.user.id);
  db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)").run(info.lastInsertRowid, req.session.user.id);
  res.json({ ok: true, group_id: info.lastInsertRowid });
});

app.post("/api/groups/:groupId/invite", requireAuth, (req, res) => {
  const groupId = Number(req.params.groupId);
  const { username } = req.body;
  const group = db.prepare("SELECT * FROM groups WHERE id = ?").get(groupId);
  if (!group) return res.status(404).json({ error: "Group not found" });
  const isMember = db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, req.session.user.id);
  if (!isMember) return res.status(403).json({ error: "Not a member" });

  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) return res.status(404).json({ error: "User not found" });

  const existing = db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, user.id);
  if (existing) return res.status(409).json({ error: "Already in group" });

  db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)").run(groupId, user.id);
  res.json({ ok: true });
});

app.post("/api/groups/:groupId/channels/create", requireAuth, (req, res) => {
  const groupId = Number(req.params.groupId);
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });
  const isMember = db.prepare("SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?").get(groupId, req.session.user.id);
  if (!isMember) return res.status(403).json({ error: "Not a member" });
  const info = db.prepare("INSERT INTO channels (group_id, name) VALUES (?, ?)").run(groupId, name);
  res.json({ ok: true, channel_id: info.lastInsertRowid });
});

app.get("/api/groups/my", requireAuth, (req, res) => {
  const groups = db.prepare(`
    SELECT g.id, g.name,
      (SELECT json_group_array(json_object('id', u.id, 'username', u.username, 'avatar_url', u.avatar_url))
         FROM group_members gm
         JOIN users u ON u.id = gm.user_id
        WHERE gm.group_id = g.id) as members,
      (SELECT json_group_array(json_object('id', c.id, 'name', c.name))
         FROM channels c WHERE c.group_id = g.id) as channels
    FROM group_members x
    JOIN groups g ON g.id = x.group_id
    WHERE x.user_id = ?
  `).all(req.session.user.id);
  res.json({ groups });
});

// ---------- Uploads ----------
app.post("/api/upload", requireAuth, upload.array("files", 64), (req, res) => {
  const saved = req.files.map(f => ({
    original: f.originalname,
    url: `/uploads/${f.filename}`,
    mimetype: f.mimetype,
    size: f.size
  }));
  res.json({ ok: true, files: saved });
});

// ---------- Messages ----------
app.post("/api/messages/send", requireAuth, (req, res) => {
  const { type, target_id, channel_id, text, attachments } = req.body;
  if (!["direct","group","channel"].includes(type)) return res.status(400).json({ error: "Invalid type" });

  if (type === "direct") {
    const friend = db.prepare("SELECT 1 FROM friends WHERE user_id=? AND friend_id=? AND status='accepted'").get(req.session.user.id,target_id);
    if (!friend) return res.status(403).json({ error: "Not friends" });
  } else if (type === "group") {
    const member = db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?").get(target_id, req.session.user.id);
    if (!member) return res.status(403).json({ error: "Not in group" });
  } else if (type === "channel") {
    const ch = db.prepare("SELECT * FROM channels WHERE id=?").get(channel_id);
    if (!ch) return res.status(404).json({ error: "Channel not found" });
    const member = db.prepare("SELECT 1 FROM group_members WHERE group_id=? AND user_id=?").get(ch.group_id, req.session.user.id);
    if (!member) return res.status(403).json({ error: "Not in group" });
  }

  const id = uuidv4();
  const now = Date.now();
  const jsonAttachments = JSON.stringify(attachments || []);
  db.prepare("INSERT INTO messages (id,type,sender_id,target_id,channel_id,content,attachments_json,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id,type,req.session.user.id,target_id||null,channel_id||null,text||"",jsonAttachments,now);

  const payload = { id,type,sender:currentUser(req),target_id,channel_id,content:text||"",attachments:attachments||[],created_at:now };
  if (type==="direct") {
    io.to(`user:${target_id}`).emit("msg:new",payload);
    io.to(`user:${req.session.user.id}`).emit("msg:new",payload);
  } else if (type==="group") io.to(`group:${target_id}`).emit("msg:new",payload);
  else if (type==="channel") io.to(`channel:${channel_id}`).emit("msg:new",payload);

  res.json({ ok:true, id });
});

app.get("/api/messages/history", requireAuth, (req, res) => {
  const { type, target_id, channel_id, limit = 50 } = req.query;
  const rows = db.prepare(`
    SELECT m.*, u.username, u.avatar_url
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.type=? AND (m.target_id=? OR ? IS NULL) AND (m.channel_id=? OR ? IS NULL)
    ORDER BY m.created_at DESC
    LIMIT ?
  `).all(type, or_undefined(target_id), or_undefined(target_id), or_undefined(channel_id), or_undefined(channel_id), Number(limit));
  res.json({ messages: rows.reverse() });
});

// ---------- Socket.IO ----------
io.on("connection", socket => {
  const req = socket.request;
  const sess = req.session;
  if (!sess?.user) { socket.disconnect(); return; }
  const userId = sess.user.id;
  socket.join(`user:${userId}`);

  socket.on("room:join", ({ room }) => socket.join(room));
  socket.on("room:leave", ({ room }) => socket.leave(room));
  socket.on("typing", payload => { if(payload.room) io.to(payload.room).emit("typing",{userId,...payload}); });

  socket.on("voice:join", ({ room }) => { socket.join(`voice:${room}`); socket.to(`voice:${room}`).emit("voice:peer-joined",{userId}); });
  socket.on("voice:leave", ({ room }) => { socket.leave(`voice:${room}`); socket.to(`voice:${room}`).emit("voice:peer-left",{userId}); });
  socket.on("voice:signal", ({ room, data, to }) => {
    if(to) io.to(to).emit("voice:signal",{from:socket.id,data});
    else socket.to(`voice:${room}`).emit("voice:signal",{from:socket.id,data});
  });
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
