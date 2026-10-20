"use strict";

/**
 * ============================================================
 * QUICKTEL BUNDLES — M-PESA BUY GOODS ONLINE STK PUSH
 * Node.js 24.x | Vercel Serverless Functions
 * ============================================================
 *
 * Endpoint:
 * POST https://samsoft-coral.vercel.app/api/stkpush
 *
 * Required environment variables:
 * CONSUMER_KEY
 * CONSUMER_SECRET
 * SHORTCODE
 * TILL_NUMBER
 * PASSKEY
 * CALLBACK_URL
 *
 * Optional:
 * ALLOWED_ORIGINS
 * MIN_AMOUNT
 * MAX_AMOUNT
 * REQUEST_TIMEOUT_MS
 *
 * Transaction:
 * CustomerBuyGoodsOnline
 *
 * IMPORTANT:
 * HTTP 200 means Safaricom accepted the request.
 * It does not confirm successful payment.
 * Confirm the final result through the callback.
 * ============================================================
 */

const axios = require("axios");

// ============================================================
// CONFIGURATION
// ============================================================

const SAFARICOM_BASE_URL =
  "https://api.safaricom.co.ke";

const ACCESS_TOKEN_URL =
  `${SAFARICOM_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;

const STK_PUSH_URL =
  `${SAFARICOM_BASE_URL}/mpesa/stkpush/v1/processrequest`;

const BUILD_VERSION =
  "quicktel-stk-node24-2026-10-21-v1";

const REQUEST_TIMEOUT_MS =
  Number(process.env.REQUEST_TIMEOUT_MS || 30000);

const MIN_AMOUNT =
  Number(process.env.MIN_AMOUNT || 1);

const MAX_AMOUNT =
  Number(process.env.MAX_AMOUNT || 250000);

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  "https://quicktel-bundle.onrender.com"
)
  .split(",")
  .map(origin => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

// ============================================================
// RESPONSE HELPERS
// ============================================================

function sendJson(res, status, body) {
  return res.status(status).json(body);
}

function sendError(res, status, message, code) {
  return sendJson(res, status, {
    success: false,
    message,
    code
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

  // Postman and server-to-server clients may omit Origin.
  // This does not mean those clients are authenticated.
  if (!origin) {
    return true;
  }

  const normalizedOrigin =
    origin.replace(/\/+$/, "");

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
  let body = req.body;

  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return null;
  }

  return body;
}

// ============================================================
// ENVIRONMENT CONFIGURATION
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

  const missing = required.filter(name => {
    return !String(process.env[name] || "").trim();
  });

  if (missing.length) {
    console.error(
      `[${BUILD_VERSION}] Missing environment variables:`,
      missing
    );

    return {
      valid: false,
      message: "Payment service configuration is incomplete."
    };
  }

  const shortcode =
    process.env.SHORTCODE.trim();

  const tillNumber =
    process.env.TILL_NUMBER.trim();

  if (
    !/^\d+$/.test(shortcode) ||
    !/^\d+$/.test(tillNumber)
  ) {
    return {
      valid: false,
      message: "Payment configuration is invalid."
    };
  }

  let callbackUrl;

  try {
    callbackUrl = new URL(
      process.env.CALLBACK_URL.trim()
    );
  } catch {
    return {
      valid: false,
      message: "The payment callback URL is invalid."
    };
  }

  if (
    callbackUrl.protocol !== "https:" ||
    !callbackUrl.hostname
  ) {
    return {
      valid: false,
      message: "The callback URL must use HTTPS."
    };
  }

  if (
    !Number.isFinite(REQUEST_TIMEOUT_MS) ||
    REQUEST_TIMEOUT_MS < 1000 ||
    REQUEST_TIMEOUT_MS > 60000
  ) {
    return {
      valid: false,
      message: "Payment timeout configuration is invalid."
    };
  }

  if (
    !Number.isSafeInteger(MIN_AMOUNT) ||
    !Number.isSafeInteger(MAX_AMOUNT) ||
    MIN_AMOUNT < 1 ||
    MAX_AMOUNT < MIN_AMOUNT ||
    MAX_AMOUNT > 250000
  ) {
    return {
      valid: false,
      message: "Payment amount configuration is invalid."
    };
  }

  return {
    valid: true,
    consumerKey: process.env.CONSUMER_KEY.trim(),
    consumerSecret: process.env.CONSUMER_SECRET.trim(),
    shortcode,
    tillNumber,
    passkey: process.env.PASSKEY.trim(),
    callbackUrl: callbackUrl.toString()
  };
}

// ============================================================
// PHONE NORMALIZATION
// ============================================================

function normalizeKenyanPhone(value) {
  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    return null;
  }

  let phone = String(value).trim();

  phone = phone.replace(/[\s\-()]/g, "");

  if (phone.startsWith("+254")) {
    phone = phone.slice(1);
  }

  if (/^0[17]\d{8}$/.test(phone)) {
    phone = "254" + phone.slice(1);
  }

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

  if (
    typeof value !== "number" &&
    typeof value !== "string"
  ) {
    return null;
  }

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
// NAIROBI TIMESTAMP
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
// SAFE ERROR LOGGING
// ============================================================

function logProviderError(stage, error) {
  console.error(
    `[${BUILD_VERSION}] ${stage} failed`,
    {
      status: error.response?.status || null,
      errorCode: error.response?.data?.errorCode || null,
      errorMessage:
        error.response?.data?.errorMessage || null,
      networkCode: error.code || null
    }
  );
}

// ============================================================
// ACCESS TOKEN
// ============================================================

async function getAccessToken(config) {
  const credentials = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`
  ).toString("base64");

  let response;

  try {
    response = await axios.get(
      ACCESS_TOKEN_URL,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: "application/json"
        },
        timeout: REQUEST_TIMEOUT_MS
      }
    );
  } catch (error) {
    logProviderError("ACCESS TOKEN", error);

    const failure = new Error(
      "Unable to authenticate with the payment provider."
    );

    failure.stage = "ACCESS_TOKEN";
    failure.status = error.response?.status || null;
    failure.code = error.code || null;

    throw failure;
  }

  const token = response.data?.access_token;

  if (
    typeof token !== "string" ||
    token.length === 0
  ) {
    throw new Error(
      "The payment provider returned an invalid access token."
    );
  }

  return token;
}

// ============================================================
// ERROR MAPPING
// ============================================================

function mapProviderError(error) {
  if (
    error.code === "ECONNABORTED" ||
    error.code === "ETIMEDOUT"
  ) {
    return {
      status: 504,
      code: "PAYMENT_TIMEOUT",
      message:
        "The request timed out. Check the payment status before retrying."
    };
  }

  if (
    error.status === 401 ||
    error.status === 403
  ) {
    return {
      status: 502,
      code: "PROVIDER_AUTHENTICATION_ERROR",
      message:
        "The payment provider rejected authentication. Check your production credentials."
    };
  }

  if (error.status === 400) {
    return {
      status: 502,
      code: "PROVIDER_REQUEST_REJECTED",
      message:
        "The payment provider rejected the request. Check your Vercel logs."
    };
  }

  return {
    status: 502,
    code: "PAYMENT_PROVIDER_ERROR",
    message:
      "The payment provider could not process the request."
  };
}

// ============================================================
// MAIN HANDLER
// ============================================================

module.exports = async function handler(req, res) {
  res.setHeader(
    "X-Quicktel-Payment-Version",
    BUILD_VERSION
  );

  // CORS
  if (!configureCors(req, res)) {
    return sendError(
      res,
      403,
      "This origin is not permitted.",
      "ORIGIN_NOT_ALLOWED"
    );
  }

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Method
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");

    return sendError(
      res,
      405,
      "Use POST to initiate a payment.",
      "METHOD_NOT_ALLOWED"
    );
  }

  // Configuration
  const config = getConfiguration();

  if (!config.valid) {
    return sendError(
      res,
      500,
      config.message,
      "PAYMENT_CONFIGURATION_ERROR"
    );
  }

  // Request body
  const body = getRequestBody(req);

  if (!body) {
    return sendError(
      res,
      400,
      "A valid JSON request body is required.",
      "INVALID_REQUEST_BODY"
    );
  }

  // Phone
  const phone = normalizeKenyanPhone(
    body.phone ??
    body.phoneNumber ??
    body.msisdn
  );

  if (!phone) {
    return sendError(
      res,
      400,
      "Enter a valid Kenyan mobile number.",
      "INVALID_PHONE"
    );
  }

  // Amount
  const amount = validateAmount(body.amount);

  if (amount === null) {
    return sendError(
      res,
      400,
      `Amount must be a whole number between ${MIN_AMOUNT} and ${MAX_AMOUNT}.`,
      "INVALID_AMOUNT"
    );
  }

  // Timestamp and password
  const timestamp = getNairobiTimestamp();

  const password = Buffer.from(
    config.shortcode +
    config.passkey +
    timestamp
  ).toString("base64");

  // STK payload
  const payload = {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerBuyGoodsOnline",
    Amount: amount,
    PartyA: phone,
    PartyB: config.tillNumber,
    PhoneNumber: phone,
    CallBackURL: config.callbackUrl,
    AccountReference: "Quicktel",
    TransactionDesc: "Bundles Payment"
  };

  // Access token
  let accessToken;

  try {
    accessToken = await getAccessToken(config);
  } catch (error) {
    const failure = mapProviderError(error);

    return sendError(
      res,
      failure.status,
      failure.message,
      failure.code
    );
  }

  // STK Push
  let response;

  try {
    response = await axios.post(
      STK_PUSH_URL,
      payload,
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
    logProviderError("STK PUSH", error);

    const failure = mapProviderError({
      stage: "STK_PUSH",
      status: error.response?.status || null,
      code: error.code || null
    });

    return sendError(
      res,
      failure.status,
      failure.message,
      failure.code
    );
  }

  // Provider response
  const data = response.data || {};

  console.log(
    `[${BUILD_VERSION}] STK request result`,
    {
      httpStatus: response.status,
      responseCode: data.ResponseCode ?? null,
      merchantRequestId:
        data.MerchantRequestID ?? null,
      checkoutRequestId:
        data.CheckoutRequestID ?? null
    }
  );

  // Rejected request
  if (String(data.ResponseCode) !== "0") {
    return sendJson(res, 502, {
      success: false,
      message:
        data.ResponseDescription ||
        "Safaricom did not accept the STK Push request.",
      code: "STK_REQUEST_REJECTED"
    });
  }

  // Accepted request — payment is not yet confirmed
  return sendJson(res, 200, {
    success: true,
    status: "PENDING",
    message:
      data.CustomerMessage ||
      "STK Push accepted. Check your phone to complete payment.",
    data: {
      MerchantRequestID:
        data.MerchantRequestID || null,
      CheckoutRequestID:
        data.CheckoutRequestID || null,
      ResponseCode: "0",
      ResponseDescription:
        data.ResponseDescription ||
        "Success. Request accepted for processing",
      CustomerMessage:
        data.CustomerMessage ||
        "Check your phone to complete payment."
    }
  });
};