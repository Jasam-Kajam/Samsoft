"use strict";

/**
 * ============================================================
 * QUICKTEL BUNDLES — PRODUCTION M-PESA STK PUSH
 * ============================================================
 *
 * Hosting:
 *   Vercel
 *
 * Endpoint:
 *   https://samsoft-coral.vercel.app/api/stkpush
 *
 * Frontend:
 *   https://quicktel-bundle.onrender.com
 *
 * Transaction:
 *   CustomerBuyGoodsOnline
 *
 * PartyB:
 *   TILL_NUMBER
 *
 * Required environment variables:
 *   CONSUMER_KEY
 *   CONSUMER_SECRET
 *   SHORTCODE
 *   TILL_NUMBER
 *   PASSKEY
 *   CALLBACK_URL
 *   ALLOWED_ORIGINS
 *
 * Optional environment variables:
 *   TRANSACTION_TYPE
 *   MIN_AMOUNT
 *   MAX_AMOUNT
 *   REQUEST_TIMEOUT_MS
 * ============================================================
 */

const axios = require("axios");

// ============================================================
// CONFIGURATION
// ============================================================

const SAFARICOM_BASE_URL = "https://api.safaricom.co.ke";

const REQUEST_TIMEOUT_MS = Number(
  process.env.REQUEST_TIMEOUT_MS || 30000
);

const MIN_AMOUNT = Number(
  process.env.MIN_AMOUNT || 1
);

const MAX_AMOUNT = Number(
  process.env.MAX_AMOUNT || 250000
);

const TRANSACTION_TYPE =
  process.env.TRANSACTION_TYPE ||
  "CustomerBuyGoodsOnline";

const ALLOWED_TRANSACTION_TYPES = [
  "CustomerBuyGoodsOnline"
];

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  "https://quicktel-bundle.onrender.com"
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

// ============================================================
// RESPONSE HELPERS
// ============================================================

function sendJson(res, statusCode, data) {
  return res.status(statusCode).json(data);
}

function sendError(res, statusCode, message, code) {
  return sendJson(res, statusCode, {
    success: false,
    message,
    ...(code ? { code } : {})
  });
}

// ============================================================
// CORS
// ============================================================

function configureCors(req, res) {
  const origin = req.headers.origin;

  res.setHeader("Vary", "Origin");

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader(
    "Access-Control-Max-Age",
    "86400"
  );

  // Postman and server-to-server requests may have no Origin.
  if (!origin) {
    return true;
  }

  const normalizedOrigin = origin.replace(/\/+$/, "");

  if (!ALLOWED_ORIGINS.includes(normalizedOrigin)) {
    return false;
  }

  res.setHeader(
    "Access-Control-Allow-Origin",
    normalizedOrigin
  );

  return true;
}

// ============================================================
// REQUEST BODY
// ============================================================

function getRequestBody(req) {
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

// ============================================================
// ENVIRONMENT VALIDATION
// ============================================================

function getConfiguration() {
  const required = [
    "CONSUMER_KEY",
    "CONSUMER_SECRET",
    "SHORTCODE",
    "TILL_NUMBER",
    "PASSKEY",
    "CALLBACK_URL"
  ];

  const missing = required.filter(
    (name) => !process.env[name] ||
      !process.env[name].trim()
  );

  if (missing.length) {
    console.error(
      "Missing required environment variables:",
      missing
    );

    return {
      valid: false,
      message: "Payment service is not configured correctly."
    };
  }

  if (
    !ALLOWED_TRANSACTION_TYPES.includes(
      TRANSACTION_TYPE
    )
  ) {
    console.error(
      "Unsupported transaction type:",
      TRANSACTION_TYPE
    );

    return {
      valid: false,
      message: "Invalid payment configuration."
    };
  }

  let callback;

  try {
    callback = new URL(process.env.CALLBACK_URL);
  } catch {
    return {
      valid: false,
      message: "The payment callback URL is invalid."
    };
  }

  if (
    callback.protocol !== "https:" ||
    !callback.hostname
  ) {
    return {
      valid: false,
      message: "The payment callback must use HTTPS."
    };
  }

  if (
    !Number.isFinite(MIN_AMOUNT) ||
    !Number.isFinite(MAX_AMOUNT) ||
    MIN_AMOUNT < 1 ||
    MAX_AMOUNT < MIN_AMOUNT
  ) {
    return {
      valid: false,
      message: "The payment amount configuration is invalid."
    };
  }

  return {
    valid: true,
    consumerKey: process.env.CONSUMER_KEY.trim(),
    consumerSecret: process.env.CONSUMER_SECRET.trim(),
    shortcode: process.env.SHORTCODE.trim(),
    tillNumber: process.env.TILL_NUMBER.trim(),
    passkey: process.env.PASSKEY.trim(),
    callbackUrl: callback.toString()
  };
}

// ============================================================
// PHONE NUMBER NORMALIZATION
// ============================================================

function normalizeKenyanPhone(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }

  let phone = String(value).trim();

  // Remove common formatting characters.
  phone = phone.replace(/[\s\-()]/g, "");

  // Convert +254XXXXXXXXX to 254XXXXXXXXX.
  if (phone.startsWith("+254")) {
    phone = phone.slice(1);
  }

  // Convert 07XXXXXXXX or 01XXXXXXXX to 254XXXXXXXXX.
  if (/^0[17]\d{8}$/.test(phone)) {
    phone = "254" + phone.slice(1);
  }

  // Accept 2547XXXXXXXX or 2541XXXXXXXX.
  if (!/^254[17]\d{8}$/.test(phone)) {
    return null;
  }

  return phone;
}

// ============================================================
// AMOUNT VALIDATION
// ============================================================

function validateAmount(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  // Reject strings containing decimals, letters, or symbols.
  if (
    typeof value === "string" &&
    !/^\d+$/.test(value.trim())
  ) {
    return null;
  }

  const amount = Number(value);

  if (
    !Number.isSafeInteger(amount) ||
    amount < MIN_AMOUNT ||
    amount > MAX_AMOUNT
  ) {
    return null;
  }

  return amount;
}

// ============================================================
// TIMESTAMP — AFRICA/NAIROBI
// ============================================================

function getNairobiTimestamp() {
  const parts = new Intl.DateTimeFormat(
    "en-GB",
    {
      timeZone: "Africa/Nairobi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }
  ).formatToParts(new Date());

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

// ============================================================
// SAFARICOM ACCESS TOKEN
// ============================================================

async function getAccessToken(config) {
  const credentials = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`
  ).toString("base64");

  const response = await axios.get(
    `${SAFARICOM_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json"
      },
      timeout: REQUEST_TIMEOUT_MS
    }
  );

  const token = response.data?.access_token;

  if (!token) {
    throw new Error(
      "Safaricom did not return an access token."
    );
  }

  return token;
}

// ============================================================
// SAFARICOM ERROR HANDLING
// ============================================================

function getSafaricomErrorMessage(error) {
  const status = error.response?.status;

  const data = error.response?.data;

  // Log details for server-side diagnosis.
  // Do not send raw Safaricom responses to customers.
  console.error("Safaricom request failed:", {
    status: status || null,
    errorCode: data?.errorCode || null,
    requestId: data?.requestId || null,
    responseCode: data?.ResponseCode || null,
    responseDescription:
      data?.ResponseDescription || null,
    errorMessage:
      data?.errorMessage || null,
    message: error.message
  });

  if (error.code === "ECONNABORTED") {
    return {
      statusCode: 504,
      message:
        "The payment service timed out. Check the payment status before trying again.",
      code: "PAYMENT_TIMEOUT"
    };
  }

  if (status === 401 || status === 403) {
    return {
      statusCode: 502,
      message:
        "The payment service could not authenticate the request. Please try again later.",
      code: "PAYMENT_AUTHENTICATION_FAILED"
    };
  }

  return {
    statusCode: 502,
    message:
      "We could not initiate the payment. Please try again later.",
    code: "PAYMENT_PROVIDER_ERROR"
  };
}

// ============================================================
// STK PUSH HANDLER
// ============================================================

module.exports = async function handler(req, res) {
  // ----------------------------------------------------------
  // CORS
  // ----------------------------------------------------------

  const corsAllowed = configureCors(req, res);

  if (!corsAllowed) {
    return sendError(
      res,
      403,
      "This website is not allowed to access the payment service.",
      "ORIGIN_NOT_ALLOWED"
    );
  }

  // ----------------------------------------------------------
  // PREFLIGHT
  // ----------------------------------------------------------

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // ----------------------------------------------------------
  // HTTP METHOD
  // ----------------------------------------------------------

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");

    return sendError(
      res,
      405,
      "Method not allowed. Use POST.",
      "METHOD_NOT_ALLOWED"
    );
  }

  // ----------------------------------------------------------
  // BODY
  // ----------------------------------------------------------

  const body = getRequestBody(req);

  if (!body || Array.isArray(body)) {
    return sendError(
      res,
      400,
      "A valid JSON request body is required.",
      "INVALID_REQUEST_BODY"
    );
  }

  // ----------------------------------------------------------
  // PHONE
  // ----------------------------------------------------------

  const suppliedPhone =
    body.phone ??
    body.phoneNumber ??
    body.msisdn;

  const phone = normalizeKenyanPhone(
    suppliedPhone
  );

  if (!phone) {
    return sendError(
      res,
      400,
      "Enter a valid Kenyan mobile number, such as 0712345678.",
      "INVALID_PHONE_NUMBER"
    );
  }

  // ----------------------------------------------------------
  // AMOUNT
  // ----------------------------------------------------------

  const amount = validateAmount(body.amount);

  if (amount === null) {
    return sendError(
      res,
      400,
      `Enter a whole-number payment amount between ${MIN_AMOUNT} and ${MAX_AMOUNT} KSh.`,
      "INVALID_AMOUNT"
    );
  }

  // ----------------------------------------------------------
  // CONFIGURATION
  // ----------------------------------------------------------

  const config = getConfiguration();

  if (!config.valid) {
    return sendError(
      res,
      500,
      config.message,
      "PAYMENT_CONFIGURATION_ERROR"
    );
  }

  // ----------------------------------------------------------
  // ACCOUNT REFERENCE AND DESCRIPTION
  // ----------------------------------------------------------

  const accountReference = "Quicktel";

  const transactionDesc = "Bundles Payment";

  // ----------------------------------------------------------
  // TIMESTAMP AND PASSWORD
  // ----------------------------------------------------------

  const timestamp = getNairobiTimestamp();

  const password = Buffer.from(
    config.shortcode +
    config.passkey +
    timestamp
  ).toString("base64");

  // ----------------------------------------------------------
  // STK REQUEST
  // ----------------------------------------------------------

  const stkPayload = {
    BusinessShortCode: config.shortcode,

    Password: password,

    Timestamp: timestamp,

    TransactionType: TRANSACTION_TYPE,

    Amount: amount,

    PartyA: phone,

    PartyB: config.tillNumber,

    PhoneNumber: phone,

    CallBackURL: config.callbackUrl,

    AccountReference: accountReference,

    TransactionDesc: transactionDesc
  };

  // ----------------------------------------------------------
  // REQUEST SAFARICOM ACCESS TOKEN
  // ----------------------------------------------------------

  let accessToken;

  try {
    accessToken = await getAccessToken(config);
  } catch (error) {
    const failure = getSafaricomErrorMessage(error);

    return sendError(
      res,
      failure.statusCode,
      failure.message,
      failure.code
    );
  }

  // ----------------------------------------------------------
  // SEND STK PUSH
  // ----------------------------------------------------------

  let response;

  try {
    response = await axios.post(
      `${SAFARICOM_BASE_URL}/mpesa/stkpush/v1/processrequest`,
      stkPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        timeout: REQUEST_TIMEOUT_MS
      }
    );
  } catch (error) {
    const failure = getSafaricomErrorMessage(error);

    return sendError(
      res,
      failure.statusCode,
      failure.message,
      failure.code
    );
  }

  // ----------------------------------------------------------
  // SAFARICOM RESPONSE
  // ----------------------------------------------------------

  const data = response.data || {};

  console.log("STK Push response:", {
    ResponseCode: data.ResponseCode,
    MerchantRequestID: data.MerchantRequestID,
    CheckoutRequestID: data.CheckoutRequestID,
    ResponseDescription: data.ResponseDescription
  });

  // ----------------------------------------------------------
  // REQUEST REJECTED
  // ----------------------------------------------------------

  if (String(data.ResponseCode) !== "0") {
    return sendJson(res, 502, {
      success: false,
      message:
        data.ResponseDescription ||
        "Safaricom did not accept the payment request.",
      data: {
        ResponseCode: data.ResponseCode ?? null,
        ResponseDescription:
          data.ResponseDescription ?? null
      }
    });
  }

  // ----------------------------------------------------------
  // REQUEST ACCEPTED
  // ----------------------------------------------------------

  return sendJson(res, 200, {
    success: true,

    message:
      data.CustomerMessage ||
      "STK Push sent. Check your phone and enter your M-PESA PIN.",

    data: {
      MerchantRequestID:
        data.MerchantRequestID || null,

      CheckoutRequestID:
        data.CheckoutRequestID || null,

      ResponseCode:
        String(data.ResponseCode),

      ResponseDescription:
        data.ResponseDescription ||
        "Success. Request accepted for processing",

      CustomerMessage:
        data.CustomerMessage ||
        "Check your phone to complete the payment."
    }
  });
};