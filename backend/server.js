// backend/server.js
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json()); // replaces body-parser

// Force no caching (important for APIs)
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

// 🔑 Get M-PESA Access Token
async function getAccessToken() {
  try {
    const auth = Buffer.from(
      `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
    ).toString("base64");

    const response = await axios.get(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    return response.data.access_token;
  } catch (error) {
    console.error("🔐 Failed to fetch access token:", error.response?.data || error.message);
    throw new Error("Access token fetch failed");
  }
}

// 🟢 STK Push Endpoint
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount, accountReference } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone and amount are required" });
    }

    const access_token = await getAccessToken();

    // Correct Timestamp (YYYYMMDDHHMMSS)
    const now = new Date();
    const timestamp =
      now.getFullYear().toString() +
      ("0" + (now.getMonth() + 1)).slice(-2) +
      ("0" + now.getDate()).slice(-2) +
      ("0" + now.getHours()).slice(-2) +
      ("0" + now.getMinutes()).slice(-2) +
      ("0" + now.getSeconds()).slice(-2);

    // Password = Base64(Shortcode + Passkey + Timestamp)
    const password = Buffer.from(
      `${process.env.SHORTCODE}${process.env.PASSKEY}${timestamp}`
    ).toString("base64");

    const stkRequest = {
      BusinessShortCode: process.env.SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline", // ✅ recommended
      Amount: amount,
      PartyA: phone, // Customer's phone
      PartyB: process.env.SHORTCODE, // Paybill / Till number
      PhoneNumber: phone,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: accountReference || "Quicktel Bundles", // ✅ dynamic or default
      TransactionDesc: "Quicktel Bundles Store",
    };

    const response = await axios.post(
      "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      stkRequest,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    res.status(200).json({ message: "STK push sent", data: response.data });
  } catch (err) {
    const errorDetails = err.response?.data || err.message;
    console.error("❌ STK push failed:", errorDetails);
    res.status(500).json({ error: "STK Push failed", details: errorDetails });
  }
});

// 📞 M-PESA Callback Handler
app.post("/mpesa/callback", (req, res) => {
  console.log("📞 M-PESA Callback Received:\n", JSON.stringify(req.body, null, 2));

  const callback = req.body?.Body?.stkCallback;

  if (callback?.ResultCode === 0) {
    console.log("✅ Payment Successful:", callback);
    // TODO: Save transaction to DB or deliver product
  } else {
    console.log(`❌ Payment Failed: ${callback?.ResultDesc}`);
  }

  // Respond with JSON so Safaricom stops retrying
  res.json({
    ResultCode: 0,
    ResultDesc: "Callback received successfully",
  });
});

// 🚀 Start Server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});