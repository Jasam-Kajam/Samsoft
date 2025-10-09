// stkpush-server.js
import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

// ==========================
// Token cache
// ==========================
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const auth = Buffer.from(
    `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
  ).toString("base64");

  const url = "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const resp = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: 10000,
  });

  const { access_token, expires_in } = resp.data;
  tokenCache = {
    token: access_token,
    expiresAt: Date.now() + (Number(expires_in) - 30) * 1000,
  };

  return access_token;
}

// ==========================
// Helpers
// ==========================
const pad = (n) => (n < 10 ? "0" + n : n);

function generateTimestamp() {
  const now = new Date();
  return (
    now.getFullYear().toString() +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

function formatPhone(phone) {
  if (!phone) return null;
  if (phone.startsWith("+")) return phone.slice(1);
  if (phone.startsWith("0")) return "254" + phone.slice(1);
  return phone;
}

// ==========================
// STK Push Endpoint
// ==========================
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;
    if (!phone || !amount) {
      return res.status(400).json({ error: "phone and amount are required" });
    }

    const phoneNumber = formatPhone(phone);
    if (!/^2547\d{8}$/.test(phoneNumber)) {
      return res.status(400).json({ error: "Invalid phone number format" });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const token = await getAccessToken();
    const timestamp = generateTimestamp();
    const password = Buffer.from(
      `${process.env.SHORTCODE}${process.env.PASSKEY}${timestamp}`
    ).toString("base64");

    const stkRequest = {
      BusinessShortCode: process.env.SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline",
      Amount: numericAmount,
      PartyA: phoneNumber,
      PartyB: process.env.TILL_NUMBER,
      PhoneNumber: phoneNumber,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: phoneNumber,
      TransactionDesc: "Payment",
    };

    const resp = await axios.post(
      "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      stkRequest,
      { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
    );

    res.json({ message: "STK Push initiated", data: resp.data });
  } catch (err) {
    const details = err.response?.data || err.message;
    console.error("STK Push failed:", details);
    res.status(500).json({ error: "STK Push failed", details });
  }
});

// ==========================
// Start server
// ==========================
app.listen(port, () => {
  console.log(`🚀 STK Push server running on http://localhost:${port}`);
});