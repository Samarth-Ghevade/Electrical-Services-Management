// ===========================================
// Shree Electrical Service
// firebase.js  (now backed by MongoDB)
// Name kept so every page keeps working unchanged.
// Real work happens in mongo-client.js + server/server.js
// ===========================================

import {
    db,
    auth,
    onAuthStateChanged
} from "./mongo-client.js";

export { db, auth };

// Keep customer accounts out of OWNER pages
// (customer accounts end with @customer.shree.local)
const OWNER_PAGES = [
    "dashboard", "dashboard-data", "customers",
    "orders", "pending", "revenue", "history"
];

const currentPage =
    location.pathname.split("/").pop().replace(".html", "");

onAuthStateChanged(auth, (user) => {
    if (
        user &&
        String(user.email || "").endsWith("@customer.shree.local") &&
        OWNER_PAGES.includes(currentPage)
    ) {
        location.replace("user-dashboard.html");
    }
});
