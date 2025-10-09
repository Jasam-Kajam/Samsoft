// backend/server.js
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json({ type: "*/*" }));

// Get M-PESA Access Token
async function getAccessToken() {
  try {
    const auth = Buffer.from(
      `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
    ).toString("base64");

    const response = await axios.get(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      { headers: { Authorization: `Basic ${auth}` } }
    );

    return response.data.access_token;
  } catch (error) {
    throw new Error("Access token fetch failed");
  }
}

// STK Push Endpoint (Buy Goods)
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;
    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone and amount are required" });
    }

    let phoneNumber = phone;
    if (phone.startsWith("0")) {
      phoneNumber = "254" + phone.slice(1);
    } else if (phone.startsWith("+")) {
      phoneNumber = phone.replace("+", "");
    }

    const access_token = await getAccessToken();

    const pad = (n) => (n < 10 ? "0" + n : n);
    const now = new Date();
    const timestamp =
      now.getFullYear().toString() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      pad(now.getHours()) +
      pad(now.getMinutes()) +
      pad(now.getSeconds());

    const password = Buffer.from(
      `${process.env.SHORTCODE}${process.env.PASSKEY}${timestamp}`
    ).toString("base64");

    const stkRequest = {
      BusinessShortCode: process.env.SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline",
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: process.env.TILL_NUMBER,
      PhoneNumber: phoneNumber,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: phoneNumber,
      TransactionDesc: "BUNDLES",
    };

    const response = await axios.post(
      "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      stkRequest,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    res.status(200).json({
      message: "Confirm Payment",
      data: response.data,
    });
  } catch (err) {
    const errorDetails = err.response?.data || err.message;
    res.status(500).json({ error: "STK Push failed", details: errorDetails });
  }
});

// M-PESA Callback Handler
app.post("/mpesa/callback", (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;

    if (callback?.ResultCode === 0) {
      const metadata = callback.CallbackMetadata?.Item || [];
      const amount = metadata.find((item) => item.Name === "Amount")?.Value;
      const mpesaReceipt = metadata.find((item) => item.Name === "MpesaReceiptNumber")?.Value;
      const phoneNumber = metadata.find((item) => item.Name === "PhoneNumber")?.Value;
      const transactionDate = metadata.find((item) => item.Name === "TransactionDate")?.Value;

      // Save to DB or trigger service with { amount, mpesaReceipt, phoneNumber, transactionDate }
    }
    res.sendStatus(200);
  } catch {
    res.sendStatus(500);
  }
});

// Start Server
app.listen(port); 