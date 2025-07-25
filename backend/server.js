// server.js
const express = require("express");
const axios = require("axios");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(express.static("public")); // Serve index.html and assets

// Cold-start or any request logging
app.use((req, res, next) => {
  console.log("🔄 Incoming request:", req.method, req.url, "at", new Date().toISOString());
  next();
});

// Homepage
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Generate access token
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

// Send STK Push using HO shortcode
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
      BusinessShortCode: process.env.SHORTCODE,        // 5666236
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.SHORTCODE,                   // 5666236
      PhoneNumber: phone,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: "6448270",                     // Store Number
      TransactionDesc: "Quicktel Bundles Store 6448270",
    };

    console.log("🧾 STK Payload:", JSON.stringify(stkRequest, null, 2));
    console.log(`📤 Sending STK push to ${phone} for KES ${amount}...`);

    const response = await axios.post(
      "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      stkRequest,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    console.log("✅ STK push accepted:", response.data);
    res.status(200).json({ message: "✅ STK push sent", data: response.data });
  } catch (err) {
    const errorDetails = err.response?.data || err.message;
    console.error("❌ STK push failed:", errorDetails);
    res.status(500).json({ error: "STK Push failed", details: errorDetails });
  }
});

// Callback handler
app.post("/mpesa/callback", (req, res) => {
  const callback = req.body?.Body?.stkCallback;
  console.log("📞 M-PESA Callback Received:", JSON.stringify(callback, null, 2));

  if (callback?.ResultCode === 0) {
    console.log("✅ Payment Success!");
  } else {
    console.log(`❌ Payment Failed: Code ${callback?.ResultCode} - ${callback?.ResultDesc}`);
  }

  res.sendStatus(200);
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Quicktel Bundles API is live at http://localhost:${port}`);
});