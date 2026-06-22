require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const { Server } = require('socket.io');
const { run, get, all } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const upload = multer({ dest: path.join(__dirname, 'uploads/') });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const JWT_SECRET = process.env.JWT_SECRET || 'chatapp_secret';

function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.passwordHash,
    online: row.online === 1,
    avatar: row.avatar,
    lastSeen: row.lastSeen,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function rowToMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    room: row.room,
    from: row.fromUser,
    to: row.toUser || null,
    text: row.text,
    type: row.type,
    fileUrl: row.fileUrl,
    fileName: row.fileName,
    seenBy: JSON.parse(row.seenBy || '[]'),
    createdAt: row.createdAt
  };
}

async function createMessage({ room, from, to = null, text = '', type = 'text', fileUrl = '', fileName = '' }) {
  const createdAt = new Date().toISOString();
  const result = await run(
    `INSERT INTO messages (room, fromUser, toUser, text, type, fileUrl, fileName, seenBy, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [room, from, to, text, type, fileUrl, fileName, JSON.stringify([]), createdAt]
  );

  return {
    id: result.lastID,
    room,
    from,
    to,
    text,
    type,
    fileUrl,
    fileName,
    seenBy: [],
    createdAt
  };
}

async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid auth token' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }

  const existingUser = await get('SELECT * FROM users WHERE username = ? OR email = ?', [username, email]);
  if (existingUser) {
    return res.status(409).json({ error: 'Username or email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date().toISOString();
  const result = await run(
    `INSERT INTO users (username, email, passwordHash, online, avatar, lastSeen, createdAt, updatedAt)
     VALUES (?, ?, ?, 0, '', ?, ?, ?)`,
    [username, email, passwordHash, now, now, now]
  );

  const user = {
    id: result.lastID,
    username,
    email,
    online: false,
    avatar: '',
    lastSeen: now,
    createdAt: now,
    updatedAt: now
  };

  const token = generateToken(user);
  res.json({ token, user: { username: user.username, email: user.email, id: user.id } });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const userRow = await get('SELECT * FROM users WHERE email = ?', [email]);
  if (!userRow) return res.status(401).json({ error: 'Invalid credentials' });

  const isValid = await bcrypt.compare(password, userRow.passwordHash);
  if (!isValid) return res.status(401).json({ error: 'Invalid credentials' });

  const now = new Date().toISOString();
  await run('UPDATE users SET online = 1, lastSeen = ?, updatedAt = ? WHERE id = ?', [now, now, userRow.id]);

  const user = rowToUser({ ...userRow, online: 1, lastSeen: now, updatedAt: now });
  const token = generateToken(user);

  res.json({ token, user: { username: user.username, email: user.email, id: user.id, online: true } });
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const row = await get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const user = rowToUser(row);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash, ...publicUser } = user;
  res.json({ user: publicUser });
});

app.get('/api/rooms', authMiddleware, async (req, res) => {
  const rooms = [
    { id: 'general', name: 'General' },
    { id: 'support', name: 'Support' },
    { id: 'random', name: 'Random' }
  ];
  res.json({ rooms });
});

app.get('/api/users/online', authMiddleware, async (req, res) => {
  const rows = await all('SELECT username, email, avatar, lastSeen FROM users WHERE online = 1', []);
  res.json({ users: rows });
});

app.get('/api/messages/:room', authMiddleware, async (req, res) => {
  const room = req.params.room;
  const rows = await all('SELECT * FROM messages WHERE room = ? ORDER BY datetime(createdAt) ASC LIMIT 200', [room]);
  res.json({ messages: rows.map(rowToMessage) });
});

app.post('/api/upload', authMiddleware, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl, fileName: req.file.originalname, mimeType: req.file.mimetype });
});

const activeUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', socket => {
  const { username, id } = socket.user;
  activeUsers.set(id, { socketId: socket.id, username });

  socket.on('joinRoom', async room => {
    socket.join(room);
    const joinMessage = await createMessage({ room, from: username, type: 'system', text: `${username} joined ${room}` });
    io.to(room).emit('systemMessage', { room, text: `${username} joined`, createdAt: joinMessage.createdAt });
    emitOnlineUsers();
  });

  socket.on('leaveRoom', async room => {
    socket.leave(room);
    const leaveMessage = await createMessage({ room, from: username, type: 'system', text: `${username} left ${room}` });
    io.to(room).emit('systemMessage', { room, text: `${username} left`, createdAt: leaveMessage.createdAt });
    emitOnlineUsers();
  });

  socket.on('sendMessage', async payload => {
    const { room, text, to, type = 'text', fileUrl = '', fileName = '' } = payload;
    const message = await createMessage({ room, from: username, to: to || null, text, type, fileUrl, fileName });

    if (to) {
      const recipient = Array.from(activeUsers.values()).find(u => u.username === to);
      if (recipient) {
        io.to(recipient.socketId).emit('privateMessage', message);
      }
      socket.emit('privateMessage', message);
    } else {
      io.to(room).emit('newMessage', message);
    }
  });

  socket.on('typing', ({ room, isTyping }) => {
    socket.to(room).emit('typing', { username, isTyping });
  });

  socket.on('messageSeen', async messageId => {
    const row = await get('SELECT * FROM messages WHERE id = ?', [messageId]);
    if (!row) return;
    const message = rowToMessage(row);
    if (!message.seenBy.includes(username)) {
      const seenBy = [...message.seenBy, username];
      await run('UPDATE messages SET seenBy = ? WHERE id = ?', [JSON.stringify(seenBy), messageId]);
      io.to(message.room).emit('messageSeen', { messageId, username });
    }
  });

  socket.on('disconnect', async () => {
    activeUsers.delete(id);
    const now = new Date().toISOString();
    await run('UPDATE users SET online = 0, lastSeen = ?, updatedAt = ? WHERE id = ?', [now, now, id]);
    emitOnlineUsers();
  });
});

function emitOnlineUsers() {
  const users = Array.from(activeUsers.values()).map(user => ({ username: user.username }));
  io.emit('onlineUsers', users);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
