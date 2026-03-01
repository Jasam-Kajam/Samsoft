const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// =============================
// GET ACCESS TOKEN
// =============================
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
    console.error("Access Token Error:", error.response?.data || error.message);
    throw error;
  }
}

// =============================
// STK PUSH
// =============================
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone and amount required" });
    }

    const accessToken = await getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);

    const password = Buffer.from(
      `${process.env.SHORTCODE}${process.env.PASSKEY}${timestamp}`
    ).toString("base64");

    const stkData = {
      BusinessShortCode: process.env.SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.TILL_NUMBER,
      PhoneNumber: phone,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: "Quicktel",
      TransactionDesc: "Bundle Payment",
    };

    const response = await axios.post(
      "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      stkData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error("STK Push Error:", error.response?.data || error.message);
    res.status(500).json({
      error: "STK Push failed",
      details: error.response?.data || error.message,
    });
  }
});

// =============================
// CALLBACK
// =============================
app.post("/mpesa/callback", (req, res) => {
  console.log("Callback Received:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});