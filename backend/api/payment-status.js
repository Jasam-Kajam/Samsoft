
"use strict";

const crypto = require("crypto");
const { getDb } = require("./_lib/firebaseAdmin");

const ALLOWED_ORIGIN =
  "https://quicktel-bundle.onrender.com";

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
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

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;

  if (origin === ALLOWED_ORIGIN) {
    res.setHeader(
      "Access-Control-Allow-Origin",
      ALLOWED_ORIGIN
    );
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (origin && origin !== ALLOWED_ORIGIN) {
    return sendJson(res, 403, {
      success: false,
      message: "Origin not allowed."
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");

    return sendJson(res, 405, {
      success: false,
      message: "Use POST."
    });
  }

  const body = getBody(req) || {};
  const checkoutRequestId = body.checkoutRequestId;
  const statusToken = body.statusToken;

  if (
    typeof checkoutRequestId !== "string" ||
    !/^ws_CO_[A-Za-z0-9_-]+$/.test(checkoutRequestId) ||
    typeof statusToken !== "string" ||
    !/^[a-f0-9]{64}$/.test(statusToken)
  ) {
    return sendJson(res, 400, {
      success: false,
      message: "Invalid payment status request."
    });
  }

  try {
    const snapshot = await getDb()
      .collection("quicktelPayments")
      .doc(checkoutRequestId)
      .get();

    if (!snapshot.exists) {
      return sendJson(res, 404, {
        success: false,
        message: "Payment record not found."
      });
    }

    const payment = snapshot.data();

    // Verify the customer's payment-status token.
    const savedHash = payment.statusTokenHash;

    if (
      typeof savedHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(savedHash)
    ) {
      return sendJson(res, 403, {
        success: false,
        message: "Payment status authorization failed."
      });
    }

    const suppliedHash = crypto
      .createHash("sha256")
      .update(statusToken)
      .digest();

    const storedHash = Buffer.from(savedHash, "hex");

    if (
      storedHash.length !== suppliedHash.length ||
      !crypto.timingSafeEqual(
        storedHash,
        suppliedHash
      )
    ) {
      return sendJson(res, 403, {
        success: false,
        message: "Payment status authorization failed."
      });
    }

    const allowedStatuses = [
      "PENDING",
      "SUCCESS",
      "CANCELLED",
      "FAILED"
    ];

    const status = allowedStatuses.includes(payment.status)
      ? payment.status
      : "PENDING";

    const receiptNumber =
      payment.mpesaReceiptNumber ||
      payment.receipt ||
      null;

    const message =
      payment.resultDescription ||
      (status === "SUCCESS"
        ? "Payment successful."
        : status === "CANCELLED"
        ? "Payment was cancelled."
        : status === "FAILED"
        ? "Payment failed."
        : "Waiting for Safaricom confirmation.");

    return sendJson(res, 200, {
      success: true,
      status,
      message,
      receiptNumber,
      amount: payment.amount ?? null
    });
  } catch (error) {
    console.error(
      "Payment status lookup failed:",
      error.message
    );

    return sendJson(res, 500, {
      success: false,
      message:
        "Unable to check payment status right now."
    });
  }
};
