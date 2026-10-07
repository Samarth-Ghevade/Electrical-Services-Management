// Usage:  npm run create-owner -- owner@example.com YourPassword
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { MongoClient } = require("mongodb");

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 6) {
    console.log("Usage: npm run create-owner -- <email> <password (min 6 chars)>");
    process.exit(1);
}

(async () => {
    const client = await MongoClient.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017");
    const users = client.db(process.env.DB_NAME || "shree_electrical").collection("users");
    await users.createIndex({ email: 1 }, { unique: true });
    await users.updateOne(
        { email: email.toLowerCase() },
        { $set: { email: email.toLowerCase(), displayName: "Owner", passwordHash: await bcrypt.hash(password, 10), createdAt: new Date() } },
        { upsert: true }
    );
    console.log("Owner account ready:", email);
    await client.close();
})();
