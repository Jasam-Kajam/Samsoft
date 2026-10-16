"use strict";

const axios = require("axios");

// ======================================================
// QUICKTEL BUNDLES — M-PESA STK PUSH
// Backend: Vercel
// Endpoint: /api/stkpush
// ======================================================

const MPESA_BASE_URL = "https://api.safaricom.co.ke";
const REQUEST_TIMEOUT = 30000;
const MAX_AMOUNT = 250000;

// ======================================================
// NORMALIZE KENYAN PHONE NUMBER
// ======================================================

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
        throw new Error(
            "Enter a valid Kenyan Safaricom-compatible phone number."
        );
    }

    return value;
}

// ======================================================
// GET CURRENT KENYAN TIMESTAMP
// Format: YYYYMMDDHHmmss
// ======================================================

function getKenyanTimestamp() {
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

// ======================================================
// GET M-PESA ACCESS TOKEN
// ======================================================

async function getAccessToken() {
    const consumerKey = process.env.CONSUMER_KEY;
    const consumerSecret = process.env.CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
        throw new Error(
            "M-PESA credentials are missing. Check CONSUMER_KEY and CONSUMER_SECRET."
        );
    }

    const auth = Buffer.from(
        `${consumerKey}:${consumerSecret}`
    ).toString("base64");

    const response = await axios.get(
        `${MPESA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
        {
            headers: {
                Authorization: `Basic ${auth}`,
                Accept: "application/json"
            },
            timeout: 15000
        }
    );

    if (!response.data || !response.data.access_token) {
        throw new Error(
            "Safaricom did not return an access token."
        );
    }

    return response.data.access_token;
}

// ======================================================
// SAFE ERROR RESPONSE
// ======================================================

function getSafaricomError(error) {
    const data = error.response?.data;

    if (data && typeof data === "object") {
        return {
            errorCode:
                data.errorCode ||
                data.code ||
                null,

            errorMessage:
                data.errorMessage ||
                data.ResponseDescription ||
                data.message ||
                "Safaricom returned an error.",

            requestId:
                data.requestId ||
                data.requestID ||
                null,

            httpStatus:
                error.response?.status || null
        };
    }

    return {
        errorCode: error.code || null,
        errorMessage: error.message || "Unknown payment error.",
        httpStatus: error.response?.status || null
    };
}

// ======================================================
// STK PUSH HANDLER
// ======================================================

module.exports = async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    // --------------------------------------------------
    // HTTP METHOD
    // --------------------------------------------------

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");

        return res.status(405).json({
            success: false,
            error: "Method not allowed. Use POST."
        });
    }

    // --------------------------------------------------
    // REQUEST BODY
    // --------------------------------------------------

    try {
        const body = req.body || {};

        const phone = body.phone;
        const amount = body.amount;

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
                error: "Phone number and amount are required."
            });
        }

        // --------------------------------------------------
        // ENVIRONMENT VARIABLES
        // --------------------------------------------------

        const shortcode = process.env.SHORTCODE;
        const passkey = process.env.PASSKEY;
        const callbackURL = process.env.CALLBACK_URL;
        const tillNumber = process.env.TILL_NUMBER;

        if (!shortcode || !passkey || !callbackURL) {
            console.error(
                "STK Push configuration is incomplete."
            );

            return res.status(500).json({
                success: false,
                error: "Payment configuration is incomplete. Check SHORTCODE, PASSKEY and CALLBACK_URL."
            });
        }

        // --------------------------------------------------
        // VALIDATE CALLBACK URL
        // --------------------------------------------------

        let parsedCallback;

        try {
            parsedCallback = new URL(callbackURL);
        } catch {
            return res.status(500).json({
                success: false,
                error: "CALLBACK_URL is not a valid URL."
            });
        }

        if (parsedCallback.protocol !== "https:") {
            return res.status(500).json({
                success: false,
                error: "CALLBACK_URL must use HTTPS."
            });
        }

        // --------------------------------------------------
        // VALIDATE PHONE
        // --------------------------------------------------

        let phoneNumber;

        try {
            phoneNumber = normalizePhone(phone);
        } catch (error) {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }

        // --------------------------------------------------
        // VALIDATE AMOUNT
        // --------------------------------------------------

        const paymentAmount = Number(amount);

        if (
            !Number.isSafeInteger(paymentAmount) ||
            paymentAmount < 1 ||
            paymentAmount > MAX_AMOUNT
        ) {
            return res.status(400).json({
                success: false,
                error: `Amount must be a whole number between 1 and ${MAX_AMOUNT}.`
            });
        }

        // --------------------------------------------------
        // VALIDATE SHORTCODE
        // --------------------------------------------------

        if (!/^\d+$/.test(String(shortcode))) {
            return res.status(500).json({
                success: false,
                error: "SHORTCODE must contain only digits."
            });
        }

        // --------------------------------------------------
        // GET ACCESS TOKEN
        // --------------------------------------------------

        const accessToken = await getAccessToken();

        // --------------------------------------------------
        // GENERATE PASSWORD AND TIMESTAMP
        // --------------------------------------------------

        const timestamp = getKenyanTimestamp();

        const password = Buffer.from(
            `${shortcode}${passkey}${timestamp}`
        ).toString("base64");

        // --------------------------------------------------
        // TRANSACTION CONFIGURATION
        // --------------------------------------------------
        //
        // CustomerBuyGoodsOnline is for the applicable
        // Buy Goods configuration.
        //
        // Confirm your Daraja account supports this type
        // and that SHORTCODE, PASSKEY and PartyB match
        // the registered configuration.
        //
        // --------------------------------------------------

        const transactionType =
            process.env.TRANSACTION_TYPE ||
            "CustomerBuyGoodsOnline";

        const partyB =
            transactionType === "CustomerPayBillOnline"
                ? shortcode
                : (tillNumber || shortcode);

        const stkPayload = {
            BusinessShortCode: shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: transactionType,
            Amount: paymentAmount,
            PartyA: phoneNumber,
            PartyB: partyB,
            PhoneNumber: phoneNumber,
            CallBackURL: callbackURL,
            AccountReference: "Quicktel",
            TransactionDesc: "BUNDLES"
        };

        // --------------------------------------------------
        // SEND STK PUSH REQUEST
        // --------------------------------------------------

        let response;

        try {
            response = await axios.post(
                `${MPESA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
                stkPayload,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    },
                    timeout: REQUEST_TIMEOUT
                }
            );
        } catch (error) {
            const details = getSafaricomError(error);

            // Never log passwords, access tokens or secrets.
            console.error("Safaricom STK Push rejected:", {
                httpStatus: details.httpStatus,
                errorCode: details.errorCode,
                errorMessage: details.errorMessage,
                requestId: details.requestId
            });

            if (error.code === "ECONNABORTED") {
                return res.status(504).json({
                    success: false,
                    error: "The payment request timed out. Check the transaction status before attempting another payment."
                });
            }

            return res.status(502).json({
                success: false,
                error: "Safaricom rejected or could not process the payment request.",
                details
            });
        }

        // --------------------------------------------------
        // PROCESS SAFARICOM RESPONSE
        // --------------------------------------------------

        const data = response.data || {};

        console.log("STK Push submission:", {
            responseCode: data.ResponseCode,
            merchantRequestId: data.MerchantRequestID || null,
            checkoutRequestId: data.CheckoutRequestID || null
        });

        // Safaricom ResponseCode 0 means the request was
        // accepted for processing, not that payment succeeded.

        if (String(data.ResponseCode) !== "0") {
            return res.status(502).json({
                success: false,
                error:
                    data.ResponseDescription ||
                    "Safaricom did not accept the STK Push request.",
                data
            });
        }

        // --------------------------------------------------
        // SUCCESSFUL SUBMISSION
        // --------------------------------------------------

        return res.status(200).json({
            success: true,
            message:
                data.CustomerMessage ||
                "Payment request sent. Check your phone to complete the payment.",
            data: {
                MerchantRequestID: data.MerchantRequestID || null,
                CheckoutRequestID: data.CheckoutRequestID || null,
                ResponseCode: data.ResponseCode,
                ResponseDescription: data.ResponseDescription || null,
                CustomerMessage: data.CustomerMessage || null
            }
        });

    } catch (error) {
        // Do not log credentials, tokens, or passwords.
        console.error("STK Push backend error:", {
            message: error.message,
            code: error.code || null
        });

        return res.status(500).json({
            success: false,
            error: "An internal error occurred while initiating the payment.",
            message: error.message || "Unknown server error."
        });
    }
};