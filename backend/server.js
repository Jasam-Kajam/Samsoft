"use strict";

const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");
require("dotenv").config();

const app = express();

// ==================================================
// CONFIGURATION
// ==================================================

const PORT = process.env.PORT || 10000;

const SAFARICOM_OAUTH_URL =
    "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

const SAFARICOM_STK_PUSH_URL =
    "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

const REQUEST_TIMEOUT = 25000;
const MAX_BODY_SIZE = "100kb";

// ==================================================
// SECURITY AND MIDDLEWARE
// ==================================================

app.disable("x-powered-by");

app.use(cors({
    origin: process.env.FRONTEND_ORIGIN || "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({
    limit: MAX_BODY_SIZE,
    strict: true
}));

// ==================================================
// SIMPLE IN-MEMORY RATE LIMITER
// ==================================================

// Note: This limiter is per process and is not shared
// between serverless instances. Use a shared rate limiter
// for a high-traffic production deployment.

const rateLimitStore = new Map();

function rateLimit(options = {}) {
    const windowMs = options.windowMs || 60000;
    const maxRequests = options.maxRequests || 10;

    return (req, res, next) => {
        const key = req.ip || "unknown";
        const now = Date.now();

        let entry = rateLimitStore.get(key);

        if (!entry || now >= entry.resetAt) {
            entry = {
                count: 0,
                resetAt: now + windowMs
            };
        }

        entry.count += 1;
        rateLimitStore.set(key, entry);

        if (entry.count > maxRequests) {
            return res.status(429).json({
                success: false,
                error: "Too many requests. Please try again shortly."
            });
        }

        // Periodically remove expired entries.
        if (rateLimitStore.size > 5000) {
            for (const [storedKey, storedValue] of rateLimitStore) {
                if (now >= storedValue.resetAt) {
                    rateLimitStore.delete(storedKey);
                }
            }
        }

        next();
    };
}

// ==================================================
// HEALTH CHECKS
// ==================================================

app.get("/", (req, res) => {
    res.status(200).json({
        service: "Quicktel Bundles API",
        status: "online",
        environment: "production",
        nodeVersion: process.version
    });
});

app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        status: "healthy",
        timestamp: new Date().toISOString()
    });
});

// ==================================================
// VALIDATE ENVIRONMENT VARIABLES
// ==================================================

function validateConfig() {
    const required = [
        "CONSUMER_KEY",
        "CONSUMER_SECRET",
        "SHORTCODE",
        "PASSKEY",
        "CALLBACK_URL"
    ];

    const missing = required.filter((name) => {
        return !process.env[name] ||
            !process.env[name].trim();
    });

    if (missing.length) {
        throw new Error(
            `Missing environment variables: ${missing.join(", ")}`
        );
    }

    if (!/^\d+$/.test(process.env.SHORTCODE.trim())) {
        throw new Error("SHORTCODE must contain digits only.");
    }

    let callback;

    try {
        callback = new URL(process.env.CALLBACK_URL.trim());
    } catch {
        throw new Error("CALLBACK_URL is not a valid URL.");
    }

    if (callback.protocol !== "https:") {
        throw new Error("CALLBACK_URL must use HTTPS.");
    }
}

// ==================================================
// NORMALIZE KENYAN PHONE NUMBERS
// ==================================================

function normalizePhone(phone) {
    if (
        phone === undefined ||
        phone === null ||
        typeof phone === "object" ||
        typeof phone === "boolean"
    ) {
        throw new Error("Enter a valid Kenyan phone number.");
    }

    let value = String(phone).replace(/\D/g, "");

    if (value.startsWith("0") && value.length === 10) {
        value = "254" + value.slice(1);
    } else if (
        (value.startsWith("7") || value.startsWith("1")) &&
        value.length === 9
    ) {
        value = "254" + value;
    }

    if (!/^254[17]\d{8}$/.test(value)) {
        throw new Error(
            "Enter a valid Kenyan phone number, e.g. 0712345678."
        );
    }

    return value;
}

// ==================================================
// VALIDATE AMOUNT
// ==================================================

function validateAmount(amount) {
    if (
        amount === undefined ||
        amount === null ||
        typeof amount === "boolean" ||
        String(amount).trim() === ""
    ) {
        throw new Error("Enter a valid payment amount.");
    }

    const value = Number(amount);

    if (
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > 250000
    ) {
        throw new Error(
            "Amount must be a whole number between KSh 1 and KSh 250,000."
        );
    }

    return value;
}

// ==================================================
// GENERATE NAIROBI TIMESTAMP
// ==================================================

function getDarajaTimestamp() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Nairobi",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());

    const values = {};

    for (const part of parts) {
        if (part.type !== "literal") {
            values[part.type] = part.value;
        }
    }

    return (
        values.year +
        values.month +
        values.day +
        values.hour +
        values.minute +
        values.second
    );
}

// ==================================================
// GET SAFARICOM ACCESS TOKEN
// ==================================================

async function getAccessToken() {
    validateConfig();

    const credentials = Buffer.from(
        `${process.env.CONSUMER_KEY.trim()}:${process.env.CONSUMER_SECRET.trim()}`
    ).toString("base64");

    try {
        const response = await axios.get(
            SAFARICOM_OAUTH_URL,
            {
                headers: {
                    Authorization: `Basic ${credentials}`
                },
                timeout: 15000
            }
        );

        if (!response.data?.access_token) {
            throw new Error("Access token missing from Safaricom response.");
        }

        return response.data.access_token;
    } catch (error) {
        console.error("Daraja authentication failed:", {
            status: error.response?.status || null,
            message:
                error.response?.data?.errorMessage ||
                error.response?.data?.error ||
                error.message
        });

        throw new Error("Safaricom authentication failed.");
    }
}

// ==================================================
// INITIATE STK PUSH
// ==================================================

app.post(
    "/stkpush",
    rateLimit({
        windowMs: 60000,
        maxRequests: 5
    }),
    async (req, res) => {
        try {
            const { phone, amount } = req.body || {};

            if (
                phone === undefined ||
                phone === null ||
                String(phone).trim() === "" ||
                amount === undefined ||
                amount === null ||
                String(amount).trim() === ""
            ) {
                return res.status(400).json({
                    success: false,
                    error: "Phone and amount are required."
                });
            }

            const phoneNumber = normalizePhone(phone);
            const paymentAmount = validateAmount(amount);

            validateConfig();

            const shortcode = process.env.SHORTCODE.trim();
            const passkey = process.env.PASSKEY.trim();
            const timestamp = getDarajaTimestamp();

            const password = Buffer.from(
                `${shortcode}${passkey}${timestamp}`
            ).toString("base64");

            const transactionType =
                process.env.TRANSACTION_TYPE ||
                "CustomerBuyGoodsOnline";

            if (
                ![
                    "CustomerBuyGoodsOnline",
                    "CustomerPayBillOnline"
                ].includes(transactionType)
            ) {
                return res.status(500).json({
                    success: false,
                    error: "Invalid transaction configuration."
                });
            }

            const partyB =
                (process.env.PARTY_B || shortcode).trim();

            if (!/^\d+$/.test(partyB)) {
                return res.status(500).json({
                    success: false,
                    error: "Invalid Party B configuration."
                });
            }

            const stkRequest = {
                BusinessShortCode: shortcode,
                Password: password,
                Timestamp: timestamp,
                TransactionType: transactionType,
                Amount: paymentAmount,
                PartyA: phoneNumber,
                PartyB: partyB,
                PhoneNumber: phoneNumber,
                CallBackURL: process.env.CALLBACK_URL.trim(),
                AccountReference: "Quicktel",
                TransactionDesc: "Quicktel Bundles"
            };

            const response = await axios.post(
                SAFARICOM_STK_PUSH_URL,
                stkRequest,
                {
                    headers: {
                        Authorization: `Bearer ${await getAccessToken()}`,
                        "Content-Type": "application/json"
                    },
                    timeout: REQUEST_TIMEOUT
                }
            );

            const data = response.data;

            console.log("STK Push submission:", {
                responseCode: data?.ResponseCode,
                merchantRequestId: data?.MerchantRequestID,
                checkoutRequestId: data?.CheckoutRequestID
            });

            if (String(data?.ResponseCode) !== "0") {
                return res.status(502).json({
                    success: false,
                    error:
                        data?.ResponseDescription ||
                        "Safaricom did not accept the payment request."
                });
            }

            return res.status(200).json({
                success: true,
                message:
                    data?.CustomerMessage ||
                    "Payment request submitted. Check your phone.",
                data: {
                    MerchantRequestID: data.MerchantRequestID,
                    CheckoutRequestID: data.CheckoutRequestID,
                    ResponseCode: data.ResponseCode,
                    CustomerMessage: data.CustomerMessage
                }
            });
        } catch (error) {
            console.error("STK Push error:", {
                status: error.response?.status || null,
                safaricomMessage:
                    error.response?.data?.errorMessage ||
                    error.response?.data?.ResponseDescription ||
                    null,
                message: error.message
            });

            if (
                error.message.startsWith("Enter a valid Kenyan phone") ||
                error.message.startsWith("Amount must") ||
                error.message.startsWith("Phone and amount")
            ) {
                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }

            if (
                error.message.startsWith("Missing environment") ||
                error.message.startsWith("SHORTCODE") ||
                error.message.startsWith("CALLBACK_URL") ||
                error.message.startsWith("Invalid transaction")
            ) {
                return res.status(500).json({
                    success: false,
                    error: "Payment service configuration error."
                });
            }

            return res.status(502).json({
                success: false,
                error: "Payment request failed. Please try again later."
            });
        }
    }
);

// ==================================================
// M-PESA STK CALLBACK
// ==================================================

app.post("/mpesa/callback", async (req, res) => {
    try {
        const callback = req.body?.Body?.stkCallback;

        if (!callback) {
            console.error("Malformed STK callback received.");

            return res.status(200).json({
                ResultCode: 0,
                ResultDesc: "Callback received."
            });
        }

        const {
            MerchantRequestID,
            CheckoutRequestID,
            ResultCode,
            ResultDesc,
            CallbackMetadata
        } = callback;

        const successful = Number(ResultCode) === 0;
        const metadata = {};

        for (const item of CallbackMetadata?.Item || []) {
            if (item && typeof item.Name === "string") {
                metadata[item.Name] = item.Value;
            }
        }

        const payment = {
            merchantRequestId: MerchantRequestID || null,
            checkoutRequestId: CheckoutRequestID || null,
            resultCode: ResultCode,
            resultDescription: ResultDesc || null,
            status: successful ? "SUCCESS" : "FAILED",
            amount: successful ? metadata.Amount ?? null : null,
            receiptNumber: successful
                ? metadata.MpesaReceiptNumber ?? null
                : null,
            transactionDate: successful
                ? metadata.TransactionDate ?? null
                : null,
            phoneNumber: successful
                ? metadata.PhoneNumber ?? null
                : null,
            receivedAt: new Date().toISOString()
        };

        console.log("STK callback received:", payment);

        /*
         * REQUIRED BEFORE PRODUCTION FULFILMENT:
         *
         * 1. Find the original order using CheckoutRequestID.
         * 2. Persist this callback in a database.
         * 3. Handle duplicate callbacks idempotently.
         * 4. Verify amount and receipt against the order.
         * 5. Fulfil only after reconciliation.
         *
         * This handler intentionally does not fulfil orders
         * because no database/order verification is configured.
         */

        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Callback received successfully."
        });
    } catch (error) {
        console.error("Callback processing error:", error.message);

        // Acknowledge callback delivery. Investigate failures
        // through logs and reconcile transactions separately.
        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Callback received."
        });
    }
});

// ==================================================
// INVALID JSON HANDLER
// ==================================================

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400) {
        return res.status(400).json({
            success: false,
            error: "Invalid JSON request body."
        });
    }

    console.error("Unhandled request error:", err.message);

    return res.status(500).json({
        success: false,
        error: "Internal server error."
    });
});

// ==================================================
// UNKNOWN ROUTES
// ==================================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "Endpoint not found.",
        path: req.path
    });
});

// ==================================================
// EXPORT EXPRESS APPLICATION
// ==================================================

module.exports = app;

// For Vercel, do not call app.listen() here.
// Ensure Vercel is configured to deploy this file
// as its Express application entry point.