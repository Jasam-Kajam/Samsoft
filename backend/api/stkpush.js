"use strict";

/**
 * ============================================================
 * QUICKTEL BUNDLES — PRODUCTION M-PESA STK PUSH
 * ============================================================
 *
 * Deployment: Vercel
 * Runtime: Node.js 24.x
 * Endpoint: https://samsoft-coral.vercel.app/api/stkpush
 * Frontend: https://quicktel-bundle.onrender.com
 *
 * Transaction: CustomerBuyGoodsOnline
 *
 * Required environment variables:
 *   CONSAMER_KEY
 *   CONSAMER_SECRET
 *   SHORTCODE
 *   TILL_NUMBER
 *   PASSKEY
 *   CALLBACK_URL
 *
 * Optional environment variables:
 *   ALLOWED_ORIGINS
 *   TRANSACTION_TYPE
 *   MIN_AMOUNT
 *   MAX_AMOUNT
 *   REQUEST_TIMEOUT_MS
 * ============================================================
 */

// ============================================================
// CONFIGURATION
// ============================================================

const VERSION = "quicktel-stk-2026-10-21-v4";

const ACCESS_TOKEN_URL =
    "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

const STK_PUSH_URL =
    "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

const DEFAULT_ALLOWED_ORIGINS = [
    "https://quicktel-bundle.onrender.com"
];

const TRANSACTION_TYPE =
    process.env.TRANSACTION_TYPE || "CustomerBuyGoodsOnline";

const MIN_AMOUNT = Number(process.env.MIN_AMOUNT || 1);
const MAX_AMOUNT = Number(process.env.MAX_AMOUNT || 250000);

const REQUEST_TIMEOUT_MS = Number(
    process.env.REQUEST_TIMEOUT_MS || 30000
);

// ============================================================
// HELPERS
// ============================================================

function sendJson(res, statusCode, data) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
}

function getAllowedOrigins() {
    const configured = process.env.ALLOWED_ORIGINS;

    if (!configured) {
        return DEFAULT_ALLOWED_ORIGINS;
    }

    return configured
        .split(",")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean);
}

function setCorsHeaders(req, res) {
    const origin = req.headers.origin;
    const allowedOrigins = getAllowedOrigins();

    if (origin && allowedOrigins.includes(origin.replace(/\/+$/, ""))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
    }

    res.setHeader(
        "Access-Control-Allow-Methods",
        "POST, OPTIONS"
    );

    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
    );

    res.setHeader("Access-Control-Max-Age", "86400");
}

function getBody(req) {
    if (req.body && typeof req.body === "object") {
        return req.body;
    }

    if (typeof req.body === "string") {
        try {
            return JSON.parse(req.body);
        } catch {
            return null;
        }
    }

    return null;
}

function normalizePhoneNumber(value) {
    if (value === undefined || value === null) {
        return null;
    }

    let phone = String(value).trim().replace(/[\s()+-]/g, "");

    if (phone.startsWith("0")) {
        phone = "254" + phone.slice(1);
    } else if (phone.startsWith("7") || phone.startsWith("1")) {
        phone = "254" + phone;
    }

    if (!/^254[17]\d{8}$/.test(phone)) {
        return null;
    }

    return phone;
}

function getTimestamp() {
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

function getConfigurationError() {
    const required = [
        "CONSAMER_KEY",
        "CONSAMER_SECRET",
        "SHORTCODE",
        "TILL_NUMBER",
        "PASSKEY",
        "CALLBACK_URL"
    ];

    const missing = required.filter((name) => {
        return !process.env[name] ||
            !String(process.env[name]).trim();
    });

    if (missing.length > 0) {
        return "Missing environment variables: " + missing.join(", ");
    }

    if (!/^\d+$/.test(process.env.SHORTCODE.trim())) {
        return "SHORTCODE must contain digits only.";
    }

    if (!/^\d+$/.test(process.env.TILL_NUMBER.trim())) {
        return "TILL_NUMBER must contain digits only.";
    }

    if (
        !Number.isInteger(MIN_AMOUNT) ||
        !Number.isInteger(MAX_AMOUNT) ||
        MIN_AMOUNT < 1 ||
        MAX_AMOUNT < MIN_AMOUNT
    ) {
        return "MIN_AMOUNT or MAX_AMOUNT configuration is invalid.";
    }

    if (
        !Number.isFinite(REQUEST_TIMEOUT_MS) ||
        REQUEST_TIMEOUT_MS < 1000
    ) {
        return "REQUEST_TIMEOUT_MS must be at least 1000.";
    }

    try {
        const callback = new URL(process.env.CALLBACK_URL);

        if (callback.protocol !== "https:") {
            return "CALLBACK_URL must use HTTPS.";
        }
    } catch {
        return "CALLBACK_URL is not a valid URL.";
    }

    return null;
}

async function fetchJson(url, options) {
    const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    const rawText = await response.text();

    let data;

    try {
        data = rawText ? JSON.parse(rawText) : {};
    } catch {
        data = { errorMessage: "The payment provider returned an invalid response." };
    }

    if (!response.ok) {
        const error = new Error(
            data.errorMessage ||
            data.error_description ||
            data.ResponseDescription ||
            "The payment provider rejected the request."
        );

        error.status = response.status;
        error.providerData = data;

        throw error;
    }

    return data;
}

// ============================================================
// SAFARICOM ACCESS TOKEN
// ============================================================

async function getAccessToken() {
    const consumerKey = process.env.CONSAMER_KEY.trim();
    const consumerSecret = process.env.CONSAMER_SECRET.trim();

    const credentials = Buffer
        .from(`${consumerKey}:${consumerSecret}`)
        .toString("base64");

    const data = await fetchJson(ACCESS_TOKEN_URL, {
        method: "GET",
        headers: {
            Authorization: `Basic ${credentials}`,
            Accept: "application/json"
        }
    });

    if (!data.access_token) {
        throw new Error("Safaricom did not return an access token.");
    }

    return data.access_token;
}

// ============================================================
// STK PUSH
// ============================================================

async function initiateStkPush({
    phone,
    amount,
    accountReference,
    transactionDescription
}) {
    const accessToken = await getAccessToken();
    const timestamp = getTimestamp();

    const shortcode = process.env.SHORTCODE.trim();
    const tillNumber = process.env.TILL_NUMBER.trim();
    const passkey = process.env.PASSKEY.trim();

    const password = Buffer
        .from(shortcode + passkey + timestamp)
        .toString("base64");

    const payload = {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: TRANSACTION_TYPE,
        Amount: amount,
        PartyA: phone,
        PartyB: tillNumber,
        PhoneNumber: phone,
        CallBackURL: process.env.CALLBACK_URL.trim(),
        AccountReference: accountReference,
        TransactionDesc: transactionDescription
    };

    return fetchJson(STK_PUSH_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json"
        },
        body: JSON.stringify(payload)
    });
}

// ============================================================
// ERROR HANDLING
// ============================================================

function getSafeErrorMessage(error) {
    if (error && error.name === "TimeoutError") {
        return "The request timed out. Check your payment status before trying again.";
    }

    if (error && error.name === "AbortError") {
        return "The request was interrupted. Check your payment status before trying again.";
    }

    if (error && error.status === 401) {
        return "Safaricom authentication failed. Check your production API credentials.";
    }

    if (error && error.status === 403) {
        return "Safaricom denied the request. Check your Daraja permissions and shortcode configuration.";
    }

    if (error && error.status === 400) {
        return "Safaricom rejected the payment details. Verify your shortcode, till number, passkey and transaction type.";
    }

    if (error && error.status >= 500) {
        return "Safaricom's payment service is temporarily unavailable. Check transaction status before retrying.";
    }

    if (
        error &&
        error.message &&
        error.message.startsWith("Missing environment variables:")
    ) {
        return error.message;
    }

    if (
        error &&
        error.message &&
        (
            error.message.includes("SHORTCODE") ||
            error.message.includes("TILL_NUMBER") ||
            error.message.includes("CALLBACK_URL") ||
            error.message.includes("MIN_AMOUNT") ||
            error.message.includes("MAX_AMOUNT") ||
            error.message.includes("REQUEST_TIMEOUT_MS")
        )
    ) {
        return error.message;
    }

    return "Unable to initiate the M-PESA payment. Please try again later.";
}

// ============================================================
// VERCEL HANDLER
// ============================================================

module.exports = async function handler(req, res) {
    setCorsHeaders(req, res);

    // CORS preflight request
    if (req.method === "OPTIONS") {
        res.statusCode = 204;
        return res.end();
    }

    // Only POST is supported
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST, OPTIONS");

        return sendJson(res, 405, {
            success: false,
            message: "Method not allowed. Use POST.",
            version: VERSION
        });
    }

    // Reject browser requests from unapproved origins.
    // Postman and server-to-server requests may have no Origin header.
    const origin = req.headers.origin;

    if (
        origin &&
        !getAllowedOrigins().includes(origin.replace(/\/+$/, ""))
    ) {
        return sendJson(res, 403, {
            success: false,
            message: "This website is not allowed to initiate payments.",
            version: VERSION
        });
    }

    // Check server configuration before processing payments.
    const configurationError = getConfigurationError();

    if (configurationError) {
        console.error("[Quicktel STK] Configuration error:", configurationError);

        return sendJson(res, 500, {
            success: false,
            message: "Payment service configuration error.",
            version: VERSION
        });
    }

    const body = getBody(req);

    if (!body) {
        return sendJson(res, 400, {
            success: false,
            message: "A valid JSON request body is required.",
            version: VERSION
        });
    }

    // Accept the phone field used by the Quicktel frontend.
    const phone = normalizePhoneNumber(
        body.phone || body.phoneNumber || body.msisdn
    );

    if (!phone) {
        return sendJson(res, 400, {
            success: false,
            message: "Enter a valid Kenyan M-PESA phone number, such as 0712345678 or 254712345678.",
            version: VERSION
        });
    }

    const rawAmount = body.amount;
    const amount = Number(rawAmount);

    if (
        rawAmount === undefined ||
        rawAmount === null ||
        String(rawAmount).trim() === "" ||
        !Number.isFinite(amount) ||
        !Number.isInteger(amount) ||
        amount < MIN_AMOUNT ||
        amount > MAX_AMOUNT
    ) {
        return sendJson(res, 400, {
            success: false,
            message: `Amount must be a whole number between Ksh ${MIN_AMOUNT} and Ksh ${MAX_AMOUNT}.`,
            version: VERSION
        });
    }

    const packageName = String(
        body.packageSize ||
        body.package ||
        body.title ||
        "Quicktel Bundle"
    )
        .trim()
        .replace(/[\r\n]/g, " ")
        .slice(0, 50);

    const accountReference = (
        packageName || "Quicktel Bundle"
    ).slice(0, 12);

    const transactionDescription = (
        "Quicktel " + (packageName || "Bundle")
    ).slice(0, 30);

    try {
        console.log("[Quicktel STK] Initiating payment", {
            version: VERSION,
            phone: phone.slice(0, 6) + "*****",
            amount,
            transactionType: TRANSACTION_TYPE
        });

        const result = await initiateStkPush({
            phone,
            amount,
            accountReference,
            transactionDescription
        });

        const accepted =
            String(result.ResponseCode) === "0" &&
            Boolean(result.CheckoutRequestID);

        if (!accepted) {
            console.error("[Quicktel STK] Provider rejected request", {
                responseCode: result.ResponseCode,
                responseDescription: result.ResponseDescription
            });

            return sendJson(res, 502, {
                success: false,
                message:
                    result.ResponseDescription ||
                    "Safaricom did not accept the STK Push request.",
                data: {
                    ResponseCode: result.ResponseCode || null
                },
                version: VERSION
            });
        }

        console.log("[Quicktel STK] Request accepted", {
            checkoutRequestId: result.CheckoutRequestID
        });

        return sendJson(res, 200, {
            success: true,
            message:
                result.CustomerMessage ||
                "STK Push request accepted. Check your phone and enter your M-PESA PIN to complete payment.",
            data: {
                MerchantRequestID: result.MerchantRequestID || null,
                CheckoutRequestID: result.CheckoutRequestID,
                ResponseCode: result.ResponseCode,
                ResponseDescription: result.ResponseDescription || null,
                CustomerMessage: result.CustomerMessage || null
            },
            version: VERSION
        });
    } catch (error) {
        console.error("[Quicktel STK] Request failed", {
            version: VERSION,
            status: error.status || null,
            errorName: error.name || "Error",
            message: error.message || "Unknown error"
        });

        const isTimeout =
            error.name === "TimeoutError" ||
            error.name === "AbortError";

        return sendJson(res, isTimeout ? 504 : 502, {
            success: false,
            message: getSafeErrorMessage(error),
            version: VERSION
        });
    }
};
