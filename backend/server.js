"use strict";

const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 10000;

const MPESA_BASE_URL =
    process.env.MPESA_ENV === "sandbox"
        ? "https://sandbox.safaricom.co.ke"
        : "https://api.safaricom.co.ke";

// ========================================
// MIDDLEWARE
// ========================================

app.use(cors());
app.use(express.json({ limit: "100kb" }));

// ========================================
// HEALTH CHECK
// ========================================

app.get("/", (req, res) => {
    res.status(200).json({
        service: "Quicktel Bundles API",
        status: "online",
        nodeVersion: process.version,
        targetNodeVersion: "24.x"
    });
});

app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        status: "healthy",
        timestamp: new Date().toISOString()
    });
});

// ========================================
// ENVIRONMENT VALIDATION
// ========================================

function validateConfig() {
    const required = [
        "CONSUMER_KEY",
        "CONSUMER_SECRET",
        "SHORTCODE",
        "PASSKEY",
        "CALLBACK_URL"
    ];

    const missing = required.filter(
        (key) => !process.env[key]
    );

    if (missing.length) {
        throw new Error(
            `Missing environment variables: ${missing.join(", ")}`
        );
    }
}

// ========================================
// NORMALIZE KENYAN PHONE NUMBERS
// ========================================

function normalizePhone(phone) {
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
            "Invalid Kenyan phone number. Use 07XXXXXXXX, 01XXXXXXXX, or 254XXXXXXXXX."
        );
    }

    return value;
}

// ========================================
// VALIDATE PAYMENT AMOUNT
// ========================================

function validateAmount(amount) {
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

// ========================================
// GET M-PESA ACCESS TOKEN
// ========================================

async function getAccessToken() {
    validateConfig();

    const credentials = Buffer.from(
        `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
    ).toString("base64");

    try {
        const response = await axios.get(
            `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
            {
                headers: {
                    Authorization: `Basic ${credentials}`
                },
                timeout: 15000
            }
        );

        if (!response.data?.access_token) {
            throw new Error(
                "Safaricom did not return an access token."
            );
        }

        return response.data.access_token;

    } catch (error) {
        console.error(
            "M-PESA authentication failed:",
            error.response?.data || error.message
        );

        throw new Error(
            "Unable to obtain the M-PESA access token."
        );
    }
}

// ========================================
// M-PESA STK PUSH
// ========================================

app.post("/stkpush", async (req, res) => {
    try {
        const { phone, amount } = req.body || {};

        if (
            phone === undefined ||
            phone === null ||
            String(phone).trim() === "" ||
            amount === undefined ||
            amount === null ||
            amount === ""
        ) {
            return res.status(400).json({
                success: false,
                error: "Phone and amount are required."
            });
        }

        const phoneNumber = normalizePhone(phone);
        const paymentAmount = validateAmount(amount);

        const accessToken = await getAccessToken();

        // Format timestamp as YYYYMMDDHHmmss.
        // Use the server's local timezone only if it is configured
        // to match the timezone expected by your Daraja integration.
        const date = new Date();

        const timestamp =
            date.getFullYear().toString() +
            String(date.getMonth() + 1).padStart(2, "0") +
            String(date.getDate()).padStart(2, "0") +
            String(date.getHours()).padStart(2, "0") +
            String(date.getMinutes()).padStart(2, "0") +
            String(date.getSeconds()).padStart(2, "0");

        const shortcode = process.env.SHORTCODE;

        const password = Buffer.from(
            `${shortcode}${process.env.PASSKEY}${timestamp}`
        ).toString("base64");

        const stkRequest = {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,

            // Confirm this transaction type with Safaricom
            // for your specific Till Number configuration.
            TransactionType: "CustomerBuyGoodsOnline",

            Amount: paymentAmount,
            PartyA: phoneNumber,
            PartyB: shortcode,
            PhoneNumber: phoneNumber,

            CallBackURL: process.env.CALLBACK_URL,

            AccountReference: "Quicktel",
            TransactionDesc: "BUNDLES"
        };

        const response = await axios.post(
            `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
            stkRequest,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                timeout: 30000
            }
        );

        console.log("STK Push response:", {
            ResponseCode: response.data?.ResponseCode,
            MerchantRequestID: response.data?.MerchantRequestID,
            CheckoutRequestID: response.data?.CheckoutRequestID
        });

        return res.status(200).json({
            success: response.data?.ResponseCode === "0",
            message:
                response.data?.CustomerMessage ||
                "STK Push request submitted.",
            data: response.data
        });

    } catch (error) {
        console.error(
            "STK Push failed:",
            error.response?.data || error.message
        );

        if (
            error.message.startsWith("Invalid Kenyan phone") ||
            error.message.startsWith("Amount must be")
        ) {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }

        return res.status(500).json({
            success: false,
            error: "STK Push failed.",
            details: error.response?.data || error.message
        });
    }
});

// ========================================
// M-PESA CALLBACK HANDLER
// ========================================

app.post("/mpesa/callback", (req, res) => {
    try {
        const callback = req.body?.Body?.stkCallback;

        if (!callback) {
            console.error(
                "Invalid M-PESA callback received."
            );

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

        console.log("M-PESA callback received:", {
            MerchantRequestID,
            CheckoutRequestID,
            ResultCode,
            ResultDesc
        });

        if (Number(ResultCode) === 0) {
            const metadata = {};

            for (
                const item of
                (CallbackMetadata?.Item || [])
            ) {
                metadata[item.Name] = item.Value;
            }

            const payment = {
                status: "SUCCESS",
                merchantRequestId: MerchantRequestID,
                checkoutRequestId: CheckoutRequestID,
                amount: metadata.Amount,
                receiptNumber: metadata.MpesaReceiptNumber,
                transactionDate: metadata.TransactionDate,
                phoneNumber: metadata.PhoneNumber
            };

            console.log(
                "Successful payment:",
                JSON.stringify(payment, null, 2)
            );

            // TODO:
            // Persist the transaction in your database.
            // Match it to the original order.
            // Verify the amount and transaction details.
            // Fulfil the order only after verification.
        } else {
            console.log("Payment was not successful:", {
                CheckoutRequestID,
                ResultCode,
                ResultDesc
            });

            // TODO: Record the failed transaction.
        }

        return res.status(200).json({
            ResultCode: 0,
            ResultDesc: "Callback received successfully."
        });

    } catch (error) {
        console.error(
            "Callback processing error:",
            error.message
        );

        return res.status(500).json({
            ResultCode: 1,
            ResultDesc: "Callback processing failed."
        });
    }
});

// ========================================
// INVALID JSON HANDLER
// ========================================

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400) {
        return res.status(400).json({
            success: false,
            error: "Invalid JSON request body."
        });
    }

    console.error("Server error:", err.message);

    return res.status(500).json({
        success: false,
        error: "Internal server error."
    });
});

// ========================================
// UNKNOWN ROUTES
// ========================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: "Endpoint not found.",
        path: req.path
    });
});

// ========================================
// EXPORT EXPRESS APP
// ========================================

// For Vercel serverless deployment.
// Do not call app.listen() in this file when
// deploying the app through Vercel.

module.exports = app;

// For standalone hosting, create a separate entry
// point that imports this app and starts app.listen().