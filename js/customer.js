// ==========================================
// Shree Electrical Service
// customer.js
// ==========================================

import { db } from "./firebase.js";

import {
    doc,
    setDoc
} from "./mongo-client.js";

console.log("customer.js loaded");

const customerForm = document.getElementById("customerForm");

if (customerForm) {

    // Set today's date
    const dateInput = document.getElementById("date");

    if (dateInput) {
        dateInput.value = new Date().toISOString().split("T")[0];
    }

    // ----------------------------------------------------
    // Keep details when the user comes BACK from the
    // services page. A fresh visit from the home page
    // (flag cleared there) starts with an empty form.
    // ----------------------------------------------------
    const FIELD_IDS = [
        "customerName", "mobile", "address",
        "village", "city", "pincode", "date"
    ];

    const KEY_MAP = { customerName: "name" };

    function restoreDetails() {

        if (sessionStorage.getItem("customerFlow") !== "active") return;

        let saved = null;

        try {
            saved = JSON.parse(localStorage.getItem("customer") || "null");
        } catch (e) { saved = null; }

        if (!saved) return;

        FIELD_IDS.forEach(function (id) {

            const input = document.getElementById(id);
            const value = saved[KEY_MAP[id] || id];

            if (input && value !== undefined && value !== null) {
                input.value = value;
            }

        });

    }

    restoreDetails();

    // Back/forward cache: re-fill when page is restored
    window.addEventListener("pageshow", function (ev) {
        if (ev.persisted) restoreDetails();
    });

    customerForm.addEventListener("submit", async function (e) {

        e.preventDefault();

        const customer = {
            name: document.getElementById("customerName").value.trim(),
            mobile: document.getElementById("mobile").value.trim(),
            address: document.getElementById("address").value.trim(),
            village: document.getElementById("village").value.trim(),
            city: document.getElementById("city").value.trim(),
            pincode: document.getElementById("pincode").value.trim(),
            date: document.getElementById("date").value
        };

        // Validation
        if (customer.name === "") {
            alert("Please enter customer name.");
            return;
        }

        if (!/^[6-9]\d{9}$/.test(customer.mobile)) {
            alert("Please enter a valid 10-digit mobile number.");
            return;
        }

        if (!/^\d{6}$/.test(customer.pincode)) {
            alert("Please enter a valid 6-digit PIN code.");
            return;
        }

        // Save locally
        customer.id = Date.now().toString();

        localStorage.setItem(
            "customer",
            JSON.stringify(customer)
        );

        // Remember that the user is in the order flow
        sessionStorage.setItem("customerFlow", "active");

        // Try saving to Firebase
        try {

            if (db) {

                // Document id = mobile number, so the same customer
                // placing another order UPDATES the record instead of
                // creating a duplicate.
                const customerId = customer.mobile;

                await setDoc(
                    doc(db, "customers", customerId),
                    customer,
                    { merge: true }
                );

                customer.id = customerId;

                localStorage.setItem(
                    "customer",
                    JSON.stringify(customer)
                );

                console.log("Customer saved to Firestore.");

            }

        } catch (error) {

            console.error("Firestore Error:", error);

            // Continue even if Firebase fails
            alert("Customer saved locally.\nFirebase sync failed.");

        }

        // Always continue to Services page
        window.location.href = "services.html";

    });

}