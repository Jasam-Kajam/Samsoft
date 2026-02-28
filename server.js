const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// =============================
// GET M-PESA ACCESS TOKEN
// =============================
async function getAccessToken() {
  try {
    const auth = Buffer.from(`${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`).toString("base64");
    const response = await axios.get(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      { headers: { Authorization: `Basic ${auth}` } }
    );
    return response.data.access_token;
  } catch (err) {
    console.error("Failed to fetch access token:", err.response?.data || err.message);
    throw new Error("Access token fetch failed");
  }
}

// =============================
// STK PUSH Endpoint
// =============================
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;
    if (!phone || !amount) return res.status(400).json({ error: "Phone and amount required" });

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
      AccountReference: "Quicktel",
      TransactionDesc: "BUNDLES",
    };

    const response = await axios.post(
      "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      stkRequest,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    res.status(200).json({ message: "CONFIRM PAYMENT ON YOUR PHONE", data: response.data });
  } catch (err) {
    console.error("STK Push failed:", err.response?.data || err.message);
    res.status(500).json({ error: "STK Push failed", details: err.response?.data || err.message });
  }
});

// =============================
// Callback Endpoint
// =============================
app.post("/mpesa/callback", (req, res) => {
  const callback = req.body?.Body?.stkCallback;
  console.log("M-PESA Callback:", JSON.stringify(callback, null, 2));

  if (callback?.ResultCode === 0) {
    console.log("✅ Payment Successful");
    // TODO: Save transaction to DB
  } else {
    console.log(`❌ Payment Failed: ${callback?.ResultDesc}`);
  }

  res.sendStatus(200);
});

// =============================
// Start Server
// =============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));