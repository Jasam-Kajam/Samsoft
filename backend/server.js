// backend/server.js
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

// Get Access Token
async function getAccessToken() {
  const auth = Buffer.from(`${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`).toString("base64");

  const response = await axios.get(
    "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    }
  );

  return response.data.access_token;
}

// STK Push Route
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone and amount required" });
    }

    const access_token = await getAccessToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const password = Buffer.from(`${process.env.SHORTCODE}${process.env.PASSKEY}${timestamp}`).toString("base64");

    const stkRequest = {
      BusinessShortCode: process.env.SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: "5666236",
      TransactionDesc: "Quicktel Bundles Store 5666236",
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

    res.status(200).json({ message: data: response.data });
  } catch (err) {
    const errorDetails = err.response?.data || err.message;
    console.error("❌ STK push failed:", errorDetails);
    res.status(500).json({ error: "STK Push failed", details: errorDetails });
  }
});

// ✅ M-PESA Callback Handler
app.post("/mpesa/callback", (req, res) => {
  const callback = req.body?.Body?.stkCallback;
  console.log("📞 M-PESA Callback Received:", JSON.stringify(callback, null, 2));

  if (callback?.ResultCode === 0) {
    console.log("✅ Payment Success!");
    // Optionally: Save to database or trigger bundle delivery
  } else {
    console.log(`❌ Payment Failed: ${callback?.ResultDesc}`);
  }

  res.sendStatus(200); // Always respond 200
});

app.listen(port, () => {
  console.log(`🚀 Backend running on http://localhost:${port}`);
});