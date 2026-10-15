"use strict";

const axios = require("axios");

// ========================================
// CONFIGURATION
// ========================================

const MPESA_BASE_URL = "https://api.safaricom.co.ke";

// ========================================
// NORMALIZE KENYAN PHONE NUMBER
// ========================================

function normalizePhone(phone) {
    let value = String(phone || "").replace(/\D/g, "");

    if (value.startsWith("0") && value.length === 10) {
        value = "254" + value.slice(1);
    } else if (
        (value.startsWith("7") || value.startsWith("1")) &&
        value.length === 9
    ) {
        value = "254" + value;
    }

    if (!/^254[17]\d{8}$/.test(value)) {
        throw new Error("Invalid Kenyan phone number.");
    }

    return value;
}

// ========================================
// GET M-PESA ACCESS TOKEN
// ========================================

async function getAccessToken() {
    const consumerKey = process.env.CONSUMER_KEY;
    const consumerSecret = process.env.CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
        throw new Error("M-PESA credentials are not configured.");
    }

    const auth = Buffer.from(
        `${consumerKey}:${consumerSecret}`
    ).toString("base64");

    const response = await axios.get(
        `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        {
            headers: {
                Authorization: `Basic ${auth}`
            },
            timeout: 15000
        }
    );

    if (!response.data?.access_token) {
        throw new Error("Failed to obtain M-PESA access token.");
    }

    return response.data.access_token;
}

// ========================================
// STK PUSH HANDLER
// ========================================

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");

        return res.status(405).json({
            success: false,
            error: "Method not allowed. Use POST."
        });
    }

    try {
        const {
            phone,
            amount
        } = req.body || {};

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
                error: "Phone number and amount are required."
            });
        }

        const shortcode = process.env.SHORTCODE;
        const passkey = process.env.PASSKEY;
        const callbackURL = process.env.CALLBACK_URL;

        if (!shortcode || !passkey || !callbackURL) {
            return res.status(500).json({
                success: false,
                error: "Payment configuration is incomplete."
            });
        }

        let phoneNumber;

        try {
            phoneNumber = normalizePhone(phone);
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }

        const paymentAmount = Number(amount);

        if (
            !Number.isSafeInteger(paymentAmount) ||
            paymentAmount < 1 ||
            paymentAmount > 250000
        ) {
            return res.status(400).json({
                success: false,
                error: "Amount must be a whole number between 1 and 250000."
            });
        }

        const callback = new URL(callbackURL);

        if (callback.protocol !== "https:") {
            return res.status(500).json({
                success: false,
                error: "The callback URL must use HTTPS."
            });
        }

        const accessToken = await getAccessToken();

        // Safaricom timestamp format: YYYYMMDDHHmmss.
        // Use the timezone required by your Daraja configuration.
        const date = new Date();

        const timestamp =
            date.getFullYear().toString() +
            String(date.getMonth() + 1).padStart(2, "0") +
            String(date.getDate()).padStart(2, "0") +
            String(date.getHours()).padStart(2, "0") +
            String(date.getMinutes()).padStart(2, "0") +
            String(date.getSeconds()).padStart(2, "0");

        const password = Buffer.from(
            `${shortcode}${passkey}${timestamp}`
        ).toString("base64");

        const stkPayload = {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,

            // Confirm this transaction type is correct
            // for your registered Till Number.
            TransactionType: "CustomerBuyGoodsOnline",

            Amount: paymentAmount,
            PartyA: phoneNumber,
            PartyB: shortcode,
            PhoneNumber: phoneNumber,
            CallBackURL: callbackURL,
            AccountReference: "Quicktel",
            TransactionDesc: "BUNDLES"
        };

        const response = await axios.post(
            `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
            stkPayload,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                timeout: 30000
            }
        );

        const data = response.data;

        console.log("STK Push response:", {
            ResponseCode: data?.ResponseCode,
            MerchantRequestID: data?.MerchantRequestID,
            CheckoutRequestID: data?.CheckoutRequestID
        });

        return res.status(200).json({
            success: data?.ResponseCode === "0",
            message:
                data?.CustomerMessage ||
                data?.ResponseDescription ||
                "STK Push request submitted.",
            data
        });

    } catch (error) {
        // Do not log credentials, access tokens, or passwords.
        console.error(
            "STK Push error:",
            error.response?.data || error.message
        );

        if (error.response) {
            return res.status(502).json({
                success: false,
                error: "Safaricom rejected or could not process the payment request.",
                details: error.response.data
            });
        }

        return res.status(500).json({
            success: false,
            error: error.message || "Payment request failed."
        });
    }
};