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
app.use(bodyParser.json({ type: "*/*" })); // handle all JSON content types

// ==========================
// Get M-PESA Access Token
// ==========================
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
    console.error(
      "🔐 Failed to fetch access token:",
      error.response?.data || error.message
    );
    throw new Error("Access tooooken fetch failed");
  }
}

// ==========================
// STK Push Endpoint (Buy Goods)
// ==========================
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone and amount are required" });
    }

    // ✅ Sanitize phone number (Safaricom expects 2547XXXXXXXX format)
    let phoneNumber = phone;
    if (phone.startsWith("0")) {
      phoneNumber = "254" + phone.slice(1);
    } else if (phone.startsWith("+")) {
      phoneNumber = phone.replace("+", "");
    }

    const access_token = await getAccessToken();

    // ✅ Generate Safaricom timestamp (Kenya local time)
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
      BusinessShortCode: process.env.SHORTCODE,   // Till Number or Shortcode
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline",  // ✅ Correct for Buy Goods
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: process.env.TILL_NUMBER,            // ✅ Till Number
      PhoneNumber: phoneNumber,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: phoneNumber,              // ✅ Required
      TransactionDesc: "BUNDLES",
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

    res.status(200).json({
      message: "Confirm Payment",
      data: response.data,
    });
  } catch (err) {
    const errorDetails = err.response?.data || err.message;
    console.error("❌ STK push failed:", errorDetails);
    res.status(500).json({ error: "STK Push failed", details: errorDetails });
  }
});

// ==========================
// M-PESA Callback Handler
// ==========================
app.post("/mpesa/callback", (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;
    console.log("📞 M-PESA Callback Received:\n", JSON.stringify(callback, null, 2));

    if (callback?.ResultCode === 0) {
      console.log("✅ Payment Successful");

      // Extract transaction details
      const metadata = callback.CallbackMetadata?.Item || [];
      const amount = metadata.find((item) => item.Name === "Amount")?.Value;
      const mpesaReceipt = metadata.find((item) => item.Name === "MpesaReceiptNumber")?.Value;
      const phoneNumber = metadata.find((item) => item.Name === "PhoneNumber")?.Value;
      const transactionDate = metadata.find((item) => item.Name === "TransactionDate")?.Value;

      console.log("📄 Payment Details:");
      console.log(" - Amount:", amount);
      console.log(" - MpesaReceiptNumber:", mpesaReceipt);
      console.log(" - Phone:", phoneNumber);
      console.log(" - Date:", transactionDate);

      // TODO: Save to DB or trigger service (e.g., deliver bundles)
    } else {
      console.log(`❌ Payment Failed: ${callback?.ResultDesc}`);
    }

    res.sendStatus(200); // ✅ Always respond 200 to prevent retries
  } catch (error) {
    console.error("⚠️ Error handling callback:", error.message);
    res.sendStatus(500);
  }
});

// ==========================
// Start Server
// ==========================
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});