const socket = io({ autoConnect: false });
let currentRoom = 'general';
let authMode = 'login';
let currentUser = null;
let currentToken = null;

const authScreen = document.getElementById('authScreen');
const chatShell = document.getElementById('chatShell');
const loginTab = document.getElementById('loginTab');
const signupTab = document.getElementById('signupTab');
const authSubmitBtn = document.getElementById('authSubmitBtn');
const switchToSignup = document.getElementById('switchToSignup');
const authError = document.getElementById('authError');
const authUsernameGroup = document.querySelector('.auth-username-group');
const emailInput = document.getElementById('emailInput');
const usernameInput = document.getElementById('usernameInput');
const passwordInput = document.getElementById('passwordInput');
const userInfo = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');
const roomList = document.getElementById('roomList');
const onlineList = document.getElementById('onlineList');
const roomName = document.getElementById('roomName');
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');
const themeBtn = document.getElementById('themeBtn');
const userPanel = document.querySelector('.user-panel');

const rooms = [
  { id: 'general', name: 'General' },
  { id: 'support', name: 'Support' },
  { id: 'random', name: 'Random' }
];

function showError(message) {
  authError.textContent = message;
}

function clearAuthFields() {
  emailInput.value = '';
  usernameInput.value = '';
  passwordInput.value = '';
}

function setAuthMode(mode) {
  authMode = mode;
  loginTab.classList.toggle('active', mode === 'login');
  signupTab.classList.toggle('active', mode === 'signup');
  authSubmitBtn.textContent = mode === 'login' ? 'Login' : 'Sign Up';
  switchToSignup.textContent = mode === 'login' ? 'Create an account' : 'Already have an account? Login';
  authUsernameGroup.classList.toggle('hidden', mode === 'login');
  showError('');
}

async function postAuth(endpoint, payload) {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Authentication failed');
    return data;
  } catch (error) {
    throw new Error(error.message);
  }
}

async function loginUser() {
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!email || !password) {
    showError('Email and password are required.');
    return;
  }

  const data = await postAuth('/api/login', { email, password });
  handleAuthSuccess(data.token, data.user);
}

async function signupUser() {
  const username = usernameInput.value.trim();
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  if (!username || !email || !password) {
    showError('Username, email and password are required.');
    return;
  }

  const data = await postAuth('/api/register', { username, email, password });
  handleAuthSuccess(data.token, data.user);
}

function handleAuthSuccess(token, user) {
  currentToken = token;
  currentUser = user;
  localStorage.setItem('chatToken', token);
  localStorage.setItem('chatUser', JSON.stringify(user));
  showChat();
  connectSocket();
}

function showChat() {
  authScreen.classList.add('hidden');
  chatShell.classList.remove('hidden');
  if (userPanel) userPanel.classList.remove('hidden');
  userInfo.textContent = `Signed in as ${currentUser.username}`;
  messageInput.disabled = false;
  sendBtn.disabled = false;
  renderRooms();
  setActiveRoom(currentRoom);
}

function showAuth() {
  authScreen.classList.remove('hidden');
  chatShell.classList.add('hidden');
  if (userPanel) userPanel.classList.add('hidden');
  messageInput.disabled = true;
  sendBtn.disabled = true;
  clearAuthFields();
  setAuthMode('login');
}

async function verifyTokenAndRestore() {
  const token = localStorage.getItem('chatToken');
  if (!token) return false;

  try {
    const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('Token invalid');
    const data = await response.json();
    currentUser = data.user;
    currentToken = token;
    showChat();
    connectSocket();
    return true;
  } catch {
    localStorage.removeItem('chatToken');
    localStorage.removeItem('chatUser');
    return false;
  }
}

function connectSocket() {
  if (!currentToken) return;
  socket.auth = { token: currentToken };
  socket.connect();
}

function renderRooms() {
  roomList.innerHTML = rooms.map(room => `<li data-room="${room.id}" class="${room.id === currentRoom ? 'active' : ''}">${room.name}</li>`).join('');
}

function addMessage(message, isSystem = false) {
  const item = document.createElement('div');
  item.className = `message ${isSystem ? 'system-message' : ''}`;
  if (isSystem) {
    item.textContent = message;
  } else {
    item.innerHTML = `<strong>${message.from}</strong><span>${message.text}</span><time>${new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>`;
  }
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setActiveRoom(roomId) {
  const previousRoom = currentRoom;
  currentRoom = roomId;
  roomName.textContent = `Room: ${rooms.find(room => room.id === roomId)?.name || roomId}`;
  document.querySelectorAll('#roomList li').forEach(el => {
    el.classList.toggle('active', el.dataset.room === roomId);
  });
  messagesEl.innerHTML = '';
  if (socket.connected && previousRoom !== roomId) {
    socket.emit('leaveRoom', previousRoom);
  }
  socket.emit('joinRoom', roomId);
}

async function handleSubmit() {
  showError('');
  authSubmitBtn.disabled = true;
  try {
    if (authMode === 'login') {
      await loginUser();
    } else {
      await signupUser();
    }
  } catch (error) {
    showError(error.message);
  } finally {
    authSubmitBtn.disabled = false;
  }
}

loginTab.addEventListener('click', () => setAuthMode('login'));
signupTab.addEventListener('click', () => setAuthMode('signup'));
authSubmitBtn.addEventListener('click', handleSubmit);
switchToSignup.addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));

roomList.addEventListener('click', event => {
  const roomItem = event.target.closest('#roomList li');
  if (!roomItem) return;
  const newRoom = roomItem.dataset.room;
  if (newRoom !== currentRoom) {
    setActiveRoom(newRoom);
  }
});

sendBtn.addEventListener('click', () => {
  const text = messageInput.value.trim();
  if (!text) return;
  const payload = { room: currentRoom, text };
  socket.emit('sendMessage', payload);
  messageInput.value = '';
  socket.emit('typing', { room: currentRoom, isTyping: false });
});

messageInput.addEventListener('input', () => {
  socket.emit('typing', { room: currentRoom, isTyping: messageInput.value.length > 0 });
});

if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
  });
}

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('chatToken');
  localStorage.removeItem('chatUser');
  currentToken = null;
  currentUser = null;
  socket.disconnect();
  showAuth();
});

socket.on('connect', () => {
  addMessage('Connected to chat server', true);
});

socket.on('disconnect', () => {
  addMessage('Disconnected from chat server', true);
});

socket.on('systemMessage', event => {
  addMessage(event.text, true);
});

socket.on('newMessage', message => {
  addMessage(message);
});

socket.on('privateMessage', message => {
  addMessage({ ...message, from: `${message.from} (private)` });
});

socket.on('onlineUsers', users => {
  onlineList.innerHTML = users.map(user => `<li>${user.username}</li>`).join('');
});

socket.on('typing', ({ username: userTyping, isTyping }) => {
  typingIndicator.textContent = isTyping ? `${userTyping} is typing...` : '';
});

(async () => {
  const restored = await verifyTokenAndRestore();
  if (!restored) {
    showAuth();
  }
})();
