# Chat Application

A real-time chat app with Node.js, Express, Socket.io, and MongoDB.

## Features

- User joins with a username
- Real-time messaging
- Multiple rooms
- Online user list
- Typing indicator
- Dark mode
- JWT authentication
- MongoDB chat history
- File uploads backend support

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the project root with:

```env
JWT_SECRET=your_secret_here
MONGO_URI=mongodb://127.0.0.1:27017/chat-app
PORT=5000
```

3. Start the app:

```bash
npm run dev
```

4. Open `http://localhost:3000`

## Notes

- The frontend is a simple static client in `public/`.
- Chat history is saved in MongoDB.
- Auth endpoints are available at `/api/register`, `/api/login`, and `/api/me`.
