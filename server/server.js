// ===========================================
// Shree Electrical Service - Node + MongoDB API
// Also serves the website files (parent folder)
// ===========================================
require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");

const {
    MONGODB_URI = "mongodb://127.0.0.1:27017",
    DB_NAME = "shree_electrical",
    JWT_SECRET = "dev-secret-change-me",
    PORT = 3000
} = process.env;

const CUSTOMER_DOMAIN = "@customer.shree.local";
const COLLECTIONS = ["orders", "customers"];

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

let db;

// ---------- helpers ----------
const wrap = (fn) => (req, res) =>
    fn(req, res).catch((e) => {
        console.error(e);
        res.status(500).json({ code: "server-error", message: e.message });
    });

const isCustomerEmail = (email) => String(email || "").endsWith(CUSTOMER_DOMAIN);

// Incoming JSON -> Mongo (revive timestamps)
function toMongo(v) {
    if (Array.isArray(v)) return v.map(toMongo);
    if (v && typeof v === "object") {
        if (v.__serverTimestamp) return new Date();
        if (v.__ts) return new Date(v.__ts);
        const o = {};
        for (const k of Object.keys(v)) o[k] = toMongo(v[k]);
        return o;
    }
    return v;
}

// Mongo -> outgoing JSON (mark dates)
function fromMongo(v) {
    if (v instanceof Date) return { __ts: v.toISOString() };
    if (Array.isArray(v)) return v.map(fromMongo);
    if (v && typeof v === "object" && !(v instanceof ObjectId)) {
        const o = {};
        for (const k of Object.keys(v)) o[k] = fromMongo(v[k]);
        return o;
    }
    return v;
}

const outDoc = (d) => {
    const { _id, ...rest } = d;
    return { id: String(_id), data: fromMongo(rest) };
};

function publicUser(u) {
    return {
        uid: String(u._id),
        email: u.email,
        displayName: u.displayName || null
    };
}

const signToken = (u) =>
    jwt.sign({ uid: String(u._id), email: u.email }, JWT_SECRET, { expiresIn: "7d" });

// ---------- auth middleware ----------
function auth(req, res, next) {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ code: "unauthenticated", message: "Login required" });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ code: "unauthenticated", message: "Session expired" });
    }
}

const ownerOnly = (req, res, next) =>
    isCustomerEmail(req.user.email)
        ? res.status(403).json({ code: "permission-denied", message: "Owner access only" })
        : next();

// ===========================================
// AUTH ROUTES
// ===========================================
app.post("/api/auth/login", wrap(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!/^\S+@\S+$/.test(email)) return res.status(400).json({ code: "auth/invalid-email" });

    const user = await db.collection("users").findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
        return res.status(401).json({ code: "auth/invalid-credential" });

    res.json({ token: signToken(user), user: publicUser(user) });
}));

// Only customers can self-register (owner is created with `npm run create-owner`)
app.post("/api/auth/register", wrap(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const displayName = String(req.body.displayName || "").trim();

    if (!isCustomerEmail(email)) return res.status(400).json({ code: "auth/invalid-email" });
    if (password.length < 6) return res.status(400).json({ code: "auth/weak-password" });
    if (await db.collection("users").findOne({ email }))
        return res.status(409).json({ code: "auth/email-already-in-use" });

    const doc = {
        email,
        displayName: displayName || null,
        passwordHash: await bcrypt.hash(password, 10),
        createdAt: new Date()
    };
    const r = await db.collection("users").insertOne(doc);
    doc._id = r.insertedId;
    res.json({ token: signToken(doc), user: publicUser(doc) });
}));

app.get("/api/auth/me", auth, wrap(async (req, res) => {
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.uid) });
    if (!user) return res.status(401).json({ code: "unauthenticated" });
    res.json({ user: publicUser(user) });
}));

app.patch("/api/auth/profile", auth, wrap(async (req, res) => {
    await db.collection("users").updateOne(
        { _id: new ObjectId(req.user.uid) },
        { $set: { displayName: String(req.body.displayName || "").trim() } }
    );
    res.json({ ok: true });
}));

// ===========================================
// DATA ROUTES  (orders, customers)
// ===========================================
function checkCollection(req, res, next) {
    if (!COLLECTIONS.includes(req.params.col))
        return res.status(404).json({ code: "not-found", message: "Unknown collection" });
    next();
}

// Customers may create orders / customer records (booking flow works
// without login, like before) and read ONLY their own orders.
// Everything else is owner-only.
const optionalAuth = (req, _res, next) => {
    const h = req.headers.authorization || "";
    if (h.startsWith("Bearer ")) {
        try { req.user = jwt.verify(h.slice(7), JWT_SECRET); } catch { /* ignore */ }
    }
    next();
};

// LIST / QUERY  (POST so filters can be sent as JSON)
app.post("/api/:col/query", checkCollection, auth, wrap(async (req, res) => {
    const filter = {};
    const where = Array.isArray(req.body.where) ? req.body.where : [];
    const ownerView = !isCustomerEmail(req.user.email);

    for (const [field, op, value] of where) {
        if (op !== "==") return res.status(400).json({ code: "invalid-argument", message: "Only == supported" });
        if (field === "id" || field === "_id") filter._id = String(value);
        else filter[field] = value;
    }

    if (!ownerView) {
        // customer: only their own orders
        if (req.params.col !== "orders")
            return res.status(403).json({ code: "permission-denied" });
        const mobile = req.user.email.replace(CUSTOMER_DOMAIN, "");
        const allowed = (filter.userId === req.user.uid) || (filter.mobile === mobile);
        if (!allowed) return res.status(403).json({ code: "permission-denied" });
    }

    const docs = await db.collection(req.params.col).find(filter).toArray();
    res.json({ docs: docs.map(outDoc) });
}));

// CREATE with auto id
app.post("/api/:col", checkCollection, optionalAuth, wrap(async (req, res) => {
    const data = toMongo(req.body.data || {});
    const _id = new ObjectId().toString();
    await db.collection(req.params.col).insertOne({ _id, ...data });
    res.json({ id: _id });
}));

// GET one
app.get("/api/:col/:id", checkCollection, auth, ownerOnly, wrap(async (req, res) => {
    const d = await db.collection(req.params.col).findOne({ _id: req.params.id });
    res.json({ exists: !!d, doc: d ? outDoc(d) : null });
}));

// SET (create/replace/merge) with a given id
app.put("/api/:col/:id", checkCollection, optionalAuth, wrap(async (req, res) => {
    const data = toMongo(req.body.data || {});
    delete data.id; delete data._id;
    const merge = !!req.body.merge;
    await db.collection(req.params.col).updateOne(
        { _id: req.params.id },
        merge ? { $set: data } : { $set: data },
        { upsert: true }
    );
    res.json({ id: req.params.id });
}));

// UPDATE
app.patch("/api/:col/:id", checkCollection, auth, ownerOnly, wrap(async (req, res) => {
    const data = toMongo(req.body.data || {});
    delete data.id; delete data._id;
    const r = await db.collection(req.params.col).updateOne({ _id: req.params.id }, { $set: data });
    if (!r.matchedCount) return res.status(404).json({ code: "not-found" });
    res.json({ ok: true });
}));

// DELETE
app.delete("/api/:col/:id", checkCollection, auth, ownerOnly, wrap(async (req, res) => {
    await db.collection(req.params.col).deleteOne({ _id: req.params.id });
    res.json({ ok: true });
}));

// ===========================================
// STATIC WEBSITE
// ===========================================
app.use(express.static(path.join(__dirname, "..")));

// ===========================================
// START
// ===========================================
MongoClient.connect(MONGODB_URI)
    .then((client) => {
        db = client.db(DB_NAME);
        return db.collection("users").createIndex({ email: 1 }, { unique: true });
    })
    .then(() => {
        app.listen(PORT, () => {
            console.log(`MongoDB connected -> ${DB_NAME}`);
            console.log(`Website + API running at http://localhost:${PORT}`);
        });
    })
    .catch((e) => {
        console.error("Could not connect to MongoDB:", e.message);
        process.exit(1);
    });
