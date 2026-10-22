
"use strict";

/**
 * ============================================================
 * QUICKTEL BUNDLES — SECURE PAYMENT STATUS API
 * ============================================================
 *
 * Endpoint:
 * https://samsoft-coral.vercel.app/api/payment-status
 *
 * Frontend:
 * https://quicktel-bundle.onrender.com
 *
 * Firebase collection:
 * quicktelPayments
 *
 * Required document fields:
 * checkoutRequestId
 * statusTokenHash
 * status
 * amount
 * packageName
 * validity
 *
 * Optional fields:
 * mpesaReceiptNumber
 * receipt
 * resultDescription
 * ============================================================
 */

const crypto = require("crypto");
const { getDb } = require("./_lib/firebaseAdmin");

// ============================================================
// CONFIGURATION
// ============================================================

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  "https://quicktel-bundle.onrender.com"
)
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const BUILD_VERSION =
  "quicktel-payment-status-2026-10-23-v2";

const ALLOWED_STATUSES = new Set([
  "PENDING",
  "SUCCESS",
  "CANCELLED",
  "FAILED"
]);

// ============================================================
// RESPONSE HELPERS
// ============================================================

function sendJson(res, statusCode, data) {
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Quicktel-Payment-Version", BUILD_VERSION);

  return res.status(statusCode).json(data);
}

function sendError(res, statusCode, message, code) {
  return sendJson(res, statusCode, {
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
    "Content-Type"
  );
  res.setHeader("Access-Control-Max-Age", "86400");

  // Permit server-to-server requests and Postman without Origin.
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

function getBody(req) {
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
// PAYMENT REFERENCE VALIDATION
// ============================================================

function isValidCheckoutRequestId(value) {
  return (
    typeof value === "string" &&
    /^ws_CO_[A-Za-z0-9_-]+$/.test(value)
  );
}

function isValidStatusToken(value) {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{64}$/.test(value)
  );
}

// ============================================================
// SECURE TOKEN VERIFICATION
// ============================================================

function verifyStatusToken(statusToken, savedHash) {
  if (
    typeof savedHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(savedHash)
  ) {
    return false;
  }

  const suppliedHash = crypto
    .createHash("sha256")
    .update(statusToken, "utf8")
    .digest();

  const storedHash = Buffer.from(savedHash, "hex");

  if (storedHash.length !== suppliedHash.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    storedHash,
    suppliedHash
  );
}

// ============================================================
// PAYMENT RESPONSE HELPERS
// ============================================================

function normalizeStatus(value) {
  const status = String(value || "")
    .trim()
    .toUpperCase();

  return ALLOWED_STATUSES.has(status)
    ? status
    : "PENDING";
}

function getPaymentMessage(payment, status) {
  if (
    typeof payment.resultDescription === "string" &&
    payment.resultDescription.trim()
  ) {
    return payment.resultDescription.trim();
  }

  switch (status) {
    case "SUCCESS":
      return "Payment successful.";

    case "CANCELLED":
      return "Payment was cancelled on the phone.";

    case "FAILED":
      return "Payment failed.";

    default:
      return "Waiting for Safaricom confirmation.";
  }
}

function getReceiptNumber(payment) {
  const receipt =
    payment.mpesaReceiptNumber ||
    payment.receipt ||
    null;

  return typeof receipt === "string" && receipt.trim()
    ? receipt.trim()
    : null;
}

function getPackageName(payment) {
  const value = payment.packageName;

  return (
    typeof value === "string" && value.trim()
  )
    ? value.trim()
    : null;
}

function getValidity(payment) {
  const value = payment.validity;

  return (
    typeof value === "string" && value.trim()
  )
    ? value.trim()
    : null;
}

// ============================================================
// MAIN HANDLER
// ============================================================

module.exports = async function handler(req, res) {
  // CORS
  if (!configureCors(req, res)) {
    return sendError(
      res,
      403,
      "Origin not allowed.",
      "ORIGIN_NOT_ALLOWED"
    );
  }

  // Browser preflight
  if (req.method === "OPTIONS") {
    res.setHeader("X-Quicktel-Payment-Version", BUILD_VERSION);
    return res.status(204).end();
  }

  // POST only
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");

    return sendError(
      res,
      405,
      "Use POST.",
      "METHOD_NOT_ALLOWED"
    );
  }

  // Parse request
  const body = getBody(req);

  if (!body) {
    return sendError(
      res,
      400,
      "A valid JSON request body is required.",
      "INVALID_REQUEST_BODY"
    );
  }

  const checkoutRequestId = body.checkoutRequestId;
  const statusToken = body.statusToken;

  // Validate request
  if (
    !isValidCheckoutRequestId(checkoutRequestId) ||
    !isValidStatusToken(statusToken)
  ) {
    return sendError(
      res,
      400,
      "Invalid payment status request.",
      "INVALID_PAYMENT_STATUS_REQUEST"
    );
  }

  try {
    // Retrieve payment record
    const snapshot = await getDb()
      .collection("quicktelPayments")
      .doc(checkoutRequestId)
      .get();

    if (!snapshot.exists) {
      return sendError(
        res,
        404,
        "Payment record not found.",
        "PAYMENT_NOT_FOUND"
      );
    }

    const payment = snapshot.data() || {};

    // Verify customer's status token
    if (
      !verifyStatusToken(
        statusToken,
        payment.statusTokenHash
      )
    ) {
      return sendError(
        res,
        403,
        "Payment status authorization failed.",
        "PAYMENT_STATUS_UNAUTHORIZED"
      );
    }

    // Normalize status
    const status = normalizeStatus(payment.status);

    // Extract confirmed payment details
    const receiptNumber = getReceiptNumber(payment);
    const packageName = getPackageName(payment);
    const validity = getValidity(payment);

    // Only report payment details saved in the record.
    const amount =
      Number.isSafeInteger(payment.amount) &&
      payment.amount >= 0
        ? payment.amount
        : null;

    const message = getPaymentMessage(
      payment,
      status
    );

    // Return status and package details to the frontend.
    return sendJson(res, 200, {
      success: true,
      checkoutRequestId,
      status,
      message,
      receiptNumber,
      amount,
      packageName,
      validity
    });
  } catch (error) {
    console.error(
      `[${BUILD_VERSION}] Payment status lookup failed:`,
      error.message
    );

    return sendError(
      res,
      500,
      "Unable to check payment status right now.",
      "PAYMENT_STATUS_LOOKUP_FAILED"
    );
  }
};
