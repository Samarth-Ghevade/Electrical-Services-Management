# Run with MongoDB

1. Install Node.js (v18+) and MongoDB Community Server (or create a free MongoDB Atlas cluster).
2. Open a terminal in the `server` folder:
   ```
   cd server
   npm install
   copy .env.example .env      (Mac/Linux: cp .env.example .env)
   ```
   Edit `.env`: set `MONGODB_URI` and a long random `JWT_SECRET`.
3. Create your owner login:
   ```
   npm run create-owner -- owner@example.com YourPassword
   ```
4. Start:
   ```
   npm start
   ```
5. Open http://localhost:3000 (the server also serves the website).

Collections created automatically: `orders`, `customers`, `users`.
