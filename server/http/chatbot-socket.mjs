// Manual end-to-end check of the chatbot over WebSocket (REST Client can't
// speak socket.io). Logs in, opens a conversation (or reuses one), sends one
// message with `chatbot:send` and prints every chatbot event until the
// assistant's reply arrives.
//
//   node http/chatbot-socket.mjs "Có cảnh báo nào đang mở không?" [conversationId]
//
// Env: BASE_URL (default http://localhost:3000), CHATBOT_USERNAME (admin),
// CHATBOT_PASSWORD (change-me). Logging in ends that user's other session
// (single-session model).
import { io } from 'socket.io-client';

const baseUrl = process.env.BASE_URL ?? 'http://localhost:3000';
const username = process.env.CHATBOT_USERNAME ?? 'admin';
const password = process.env.CHATBOT_PASSWORD ?? 'change-me';
const content = process.argv[2] ?? 'Xin chào, bạn giúp được gì?';
let conversationId = process.argv[3];

const login = await fetch(`${baseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});
if (!login.ok) {
  console.error('Login failed:', login.status, await login.text());
  process.exit(1);
}
const cookie = login.headers
  .getSetCookie()
  .map((header) => header.split(';')[0])
  .join('; ');

if (!conversationId) {
  const created = await fetch(`${baseUrl}/chatbot/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({}),
  });
  conversationId = (await created.json()).data.id;
  console.log('conversation', conversationId);
}

const socket = io(baseUrl, { extraHeaders: { Cookie: cookie } });
const timeout = setTimeout(() => {
  console.error('No reply within 120s');
  process.exit(1);
}, 120_000);

socket.on('connect_error', (error) => {
  console.error('connect_error:', error.message);
  process.exit(1);
});
socket.on('chatbot:tool_call', (event) => console.log('tool_call', event));
socket.on('chatbot:error', (event) => {
  console.error('error', event);
  process.exit(1);
});
socket.on('chatbot:message', (message) => {
  console.log(`message [${message.role}]`, message.content);
  if (message.role === 'assistant' && message.conversationId === conversationId) {
    clearTimeout(timeout);
    socket.close();
  }
});

socket.on('connect', () => {
  socket.emit('chatbot:send', { conversationId, content }, (ack) => {
    console.log('ack', JSON.stringify(ack));
    if (!ack.ok) {
      clearTimeout(timeout);
      socket.close();
    }
  });
});
