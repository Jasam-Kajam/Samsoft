
"use strict";

/**
 * ============================================================
 * QUICKTEL BUNDLES — PRODUCTION M-PESA BUY GOODS STK PUSH
 * ============================================================
 *
 * Endpoint:
 * https://samsoft-coral.vercel.app/api/stkpush
 *
 * Frontend:
 * https://quicktel-bundle.onrender.com
 *
 * Firebase collection:
 * quicktelPayments
 *
 * Required environment variables:
 * CONSAMER_KEY
 * CONSAMER_SECRET
 * SHORTCODE
 * TILL_NUMBER
 * PASSKEY
 * CALLBACK_URL
 * FIREBASE_SERVICE_ACCOUNT_JSON
 *
 * Optional:
 * ALLOWED_ORIGINS
 * MIN_AMOUNT
 * MAX_AMOUNT
 * REQUEST_TIMEOUT_MS
 * TRANSACTION_TYPE
 * ============================================================
 */

const axios = require("axios");
const crypto = require("crypto");
const { getDb } = require("./_lib/firebaseAdmin");

// ============================================================
// CONFIGURATION
// ============================================================

const SAFARICOM_BASE_URL = "https://api.safaricom.co.ke";

const STK_PUSH_URL =
  `${SAFARICOM_BASE_URL}/mpesa/stkpush/v1/processrequest`;

const ACCESS_TOKEN_URL =
  `${SAFARICOM_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`;

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

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  "https://quicktel-bundle.onrender.com"
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const BUILD_VERSION =
  "quicktel-stk-2026-10-23-v7";

const FINAL_STATUSES = new Set([
  "SUCCESS",
  "CANCELLED",
  "FAILED"
]);

// ============================================================
// RESPONSE HELPERS
// ============================================================

function sendJson(res, statusCode, body) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader("Cache-Control", "no-store");

  return res.status(statusCode).json(body);
}

function sendError(res, statusCode, message, code) {
  return sendJson(res, statusCode, {
    success: false,
    message,
    code
  });
}

// ============================================================
// PROVIDER ERROR LOGGING
// ============================================================

function sanitizeProviderResponse(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const result = {};

  for (const key of [
    "requestId",
    "errorCode",
    "errorMessage",
    "ResponseCode",
    "ResponseDescription",
    "CustomerMessage",
    "MerchantRequestID",
    "CheckoutRequestID"
  ]) {
    if (data[key] !== undefined) {
      result[key] = data[key];
    }
  }

  return result;
}

function logProviderError(stage, error) {
  console.error(`[${BUILD_VERSION}] ${stage} failed:`, {
    httpStatus: error.response?.status || null,
    providerResponse: sanitizeProviderResponse(
      error.response?.data
    ),
    networkCode: error.code || null,
    message: error.message || "Unknown provider error"
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

  res.setHeader("Access-Control-Max-Age", "86400");

  // Permit server-to-server and Postman requests without Origin.
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
  if (
    req.body &&
    typeof req.body === "object" &&
    !Array.isArray(req.body)
  ) {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      const parsed = JSON.parse(req.body);

      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
      ) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

// ============================================================
// ENVIRONMENT CONFIGURATION
// ============================================================

function getConfiguration() {
  const requiredNames = [
    "CONSAMER_KEY",
    "CONSAMER_SECRET",
    "SHORTCODE",
    "TILL_NUMBER",
    "PASSKEY",
    "CALLBACK_URL"
  ];

  const missing = requiredNames.filter((name) => {
    const value = process.env[name];

    return (
      typeof value !== "string" ||
      value.trim() === ""
    );
  });

  if (missing.length > 0) {
    console.error(
      `[${BUILD_VERSION}] Missing environment variables:`,
      missing
    );

    return {
      valid: false,
      message: "The payment service is not fully configured."
    };
  }

  if (
    TRANSACTION_TYPE !== "CustomerBuyGoodsOnline"
  ) {
    return {
      valid: false,
      message:
        "The configured transaction type is not supported."
    };
  }

  const shortcode = process.env.SHORTCODE.trim();
  const tillNumber = process.env.TILL_NUMBER.trim();
  const passkey = process.env.PASSKEY.trim();

  if (
    !/^\d+$/.test(shortcode) ||
    !/^\d+$/.test(tillNumber) ||
    !passkey
  ) {
    return {
      valid: false,
      message:
        "The configured shortcode, till number or passkey is invalid."
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
      message: "The configured callback URL is invalid."
    };
  }

  if (
    callbackUrl.protocol !== "https:" ||
    callbackUrl.username ||
    callbackUrl.password
  ) {
    return {
      valid: false,
      message:
        "The callback URL must be a valid HTTPS URL."
    };
  }

  if (
    !Number.isFinite(REQUEST_TIMEOUT_MS) ||
    REQUEST_TIMEOUT_MS < 1000 ||
    REQUEST_TIMEOUT_MS > 120000
  ) {
    return {
      valid: false,
      message: "The payment timeout configuration is invalid."
    };
  }

  if (
    !Number.isSafeInteger(MIN_AMOUNT) ||
    !Number.isSafeInteger(MAX_AMOUNT) ||
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

    // These environment variable spellings are intentional.
    consumerKey: process.env.CONSAMER_KEY.trim(),
    consumerSecret: process.env.CONSAMER_SECRET.trim(),

    shortcode,
    tillNumber,
    passkey,
    callbackUrl: callbackUrl.toString()
  };
}

// ============================================================
// KENYAN PHONE NORMALIZATION
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
// PACKAGE NAME AND VALIDITY VALIDATION
// ============================================================

function validateTextField(value, maxLength = 120) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > maxLength
  ) {
    return null;
  }

  return value.trim();
}

// ============================================================
// NAIROBI TIMESTAMP
// ============================================================

function getNairobiTimestamp() {
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

// ============================================================
// SAFARICOM ACCESS TOKEN
// ============================================================

async function getAccessToken(config) {
  const credentials = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`
  ).toString("base64");

  let response;

  try {
    response = await axios.get(ACCESS_TOKEN_URL, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json"
      },
      timeout: REQUEST_TIMEOUT_MS
    });
  } catch (error) {
    logProviderError("ACCESS TOKEN", error);

    throw {
      stage: "ACCESS_TOKEN",
      status: error.response?.status || null,
      code: error.code || null
    };
  }

  const token = response.data?.access_token;

  if (
    typeof token !== "string" ||
    token.length === 0
  ) {
    console.error(
      `[${BUILD_VERSION}] Access token response contained no token.`
    );

    throw {
      stage: "ACCESS_TOKEN",
      status: 502,
      code: "INVALID_TOKEN_RESPONSE"
    };
  }

  return token;
}

// ============================================================
// PROVIDER ERROR MAPPING
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
        "The request timed out. Check your M-PESA messages and payment status before retrying."
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
        "Safaricom rejected authentication. Check your production credentials."
    };
  }

  if (error.status === 400) {
    return {
      status: 502,
      code:
        error.stage === "STK_PUSH"
          ? "STK_REQUEST_REJECTED"
          : "TOKEN_REQUEST_REJECTED",
      message:
        error.stage === "STK_PUSH"
          ? "Safaricom rejected the STK Push request. Check Vercel logs for diagnostic details."
          : "Safaricom rejected the access-token request. Check Vercel logs."
    };
  }

  return {
    status: 502,
    code: "PAYMENT_PROVIDER_ERROR",
    message:
      "The payment provider could not process the request. Check payment status before retrying."
  };
}

// ============================================================
// SAVE FIRESTORE PAYMENT RECORD
// ============================================================

async function savePaymentTracking({
  checkoutRequestId,
  merchantRequestId,
  phone,
  amount,
  packageName,
  validity,
  statusTokenHash
}) {
  const db = getDb();

  const paymentRef = db
    .collection("quicktelPayments")
    .doc(checkoutRequestId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(paymentRef);

    const existing = snapshot.exists
      ? snapshot.data()
      : {};

    const currentStatus = String(
      existing.status || ""
    ).toUpperCase();

    const isFinal = FINAL_STATUSES.has(currentStatus);

    const record = {
      checkoutRequestId,
      merchantRequestId: merchantRequestId || null,
      phoneNumber: phone,
      amount,
      packageName,
      validity,
      statusTokenHash,
      updatedAt: new Date()
    };

    if (!snapshot.exists) {
      record.createdAt = new Date();
    }

    // Preserve final callback status if callback arrived first.
    if (!isFinal) {
      record.status = "PENDING";
      record.resultDescription =
        "Waiting for Safaricom confirmation.";
    }

    transaction.set(paymentRef, record, {
      merge: true
    });
  });
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

  // Browser preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // POST only
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");

    return sendError(
      res,
      405,
      "Use POST to initiate a payment.",
      "METHOD_NOT_ALLOWED"
    );
  }

  // Parse request
  const body = getRequestBody(req);

  if (!body) {
    return sendError(
      res,
      400,
      "A valid JSON request body is required.",
      "INVALID_REQUEST_BODY"
    );
  }

  // Validate phone
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

  // Validate amount
  const amount = validateAmount(body.amount);

  if (amount === null) {
    return sendError(
      res,
      400,
      `Amount must be a whole number between ${MIN_AMOUNT} and ${MAX_AMOUNT}.`,
      "INVALID_AMOUNT"
    );
  }

  // Validate package name.
  const packageName = validateTextField(
    body.packageName ??
    body.package ??
    body.packageSize ??
    body.title
  );

  if (!packageName) {
    return sendError(
      res,
      400,
      "A valid package name is required.",
      "INVALID_PACKAGE"
    );
  }

  // Validate package validity.
  const validity = validateTextField(
    body.validity
  );

  if (!validity) {
    return sendError(
      res,
      400,
      "Valid package validity information is required.",
      "INVALID_VALIDITY"
    );
  }

  // Validate environment
  const config = getConfiguration();

  if (!config.valid) {
    return sendError(
      res,
      500,
      config.message,
      "PAYMENT_CONFIGURATION_ERROR"
    );
  }

  // Build STK password
  const timestamp = getNairobiTimestamp();

  const password = Buffer.from(
    config.shortcode +
    config.passkey +
    timestamp
  ).toString("base64");

  // Safaricom request payload
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
    AccountReference: "Quicktel",
    TransactionDesc: "Bundles Payment"
  };

  // Get access token
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

  // Send STK request
  let response;

  try {
    response = await axios.post(
      STK_PUSH_URL,
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

  // Process Safaricom response
  const data = response.data || {};

  console.log(`[${BUILD_VERSION}] STK response:`, {
    httpStatus: response.status,
    responseCode: data.ResponseCode ?? null,
    responseDescription:
      data.ResponseDescription ?? null,
    merchantRequestId:
      data.MerchantRequestID ?? null,
    checkoutRequestId:
      data.CheckoutRequestID ?? null
  });

  // Safaricom rejected the request
  if (String(data.ResponseCode) !== "0") {
    return sendJson(res, 502, {
      success: false,
      message:
        data.ResponseDescription ||
        "Safaricom did not accept the STK Push request.",
      code: "STK_REQUEST_REJECTED",
      data: {
        ResponseCode: data.ResponseCode ?? null,
        ResponseDescription:
          data.ResponseDescription ?? null
      }
    });
  }

  // Validate checkout reference
  const checkoutRequestId =
    data.CheckoutRequestID;

  const merchantRequestId =
    data.MerchantRequestID || null;

  if (
    typeof checkoutRequestId !== "string" ||
    !/^ws_CO_[A-Za-z0-9_-]+$/.test(
      checkoutRequestId
    )
  ) {
    console.error(
      `[${BUILD_VERSION}] Accepted STK response had no valid checkout reference.`
    );

    return sendJson(res, 200, {
      success: true,
      trackingAvailable: false,
      message:
        "Safaricom accepted the request, but the payment reference was missing. Check your M-PESA messages before retrying.",
      data: {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID:
          checkoutRequestId || null,
        ResponseCode: String(data.ResponseCode)
      }
    });
  }

  // Generate a cryptographically secure status token.
  const statusToken = crypto
    .randomBytes(32)
    .toString("hex");

  const statusTokenHash = crypto
    .createHash("sha256")
    .update(statusToken)
    .digest("hex");

  // Save payment tracking before returning the token.
  try {
    await savePaymentTracking({
      checkoutRequestId,
      merchantRequestId,
      phone,
      amount,
      packageName,
      validity,
      statusTokenHash
    });
  } catch (error) {
    console.error(
      `[${BUILD_VERSION}] Payment tracking save failed:`,
      error.message
    );

    // Safaricom has already accepted the STK request.
    // Do not automatically send another STK request.
    return sendJson(res, 200, {
      success: true,
      trackingAvailable: false,
      message:
        "Safaricom accepted the request, but payment tracking could not be initialized. Check your M-PESA messages before retrying.",
      data: {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResponseCode: String(data.ResponseCode)
      }
    });
  }

  // Return the original token. Never log it.
  return sendJson(res, 200, {
    success: true,
    trackingAvailable: true,
    message:
      data.CustomerMessage ||
      "STK Push accepted. Check your phone to complete the payment.",
    data: {
      MerchantRequestID: merchantRequestId,
      CheckoutRequestID: checkoutRequestId,
      ResponseCode: String(data.ResponseCode),
      ResponseDescription:
        data.ResponseDescription ||
        "Success. Request accepted for processing",
      CustomerMessage:
        data.CustomerMessage ||
        "Check your phone to complete the payment.",
      packageName,
      validity,
      amount,
      statusToken
    }
  });
};
