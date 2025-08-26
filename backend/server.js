// backend/server.js
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const Africastalking = require("africastalking");

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(bodyParser.json());

// ✅ Configure Africa’s Talking
const at = Africastalking({
  apiKey: process.env.AT_API_KEY, // Africa’s Talking API key
  username: process.env.AT_USERNAME || "sandbox", // sandbox or live username
});
const sms = at.SMS;

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
    console.error(
      "🔐 Failed to fetch access token:",
      error.response?.data || error.message
    );
    throw new Error("Access token fetch failed");
  }
}

// 📌 Register C2B URLs (run once in production)
app.get("/register-url", async (req, res) => {
  try {
    const access_token = await getAccessToken();

    const registerPayload = {
      ShortCode: process.env.SHORTCODE,
      ResponseType: "Completed",
      ConfirmationURL: `${process.env.BASE_URL}/mpesa/confirmation`,
      ValidationURL: `${process.env.BASE_URL}/mpesa/validation`,
    };

    const response = await axios.post(
      "https://api.safaricom.co.ke/mpesa/c2b/v1/registerurl",
      registerPayload,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    res.status(200).json({
      message: "✅ URLs registered successfully",
      data: response.data,
    });
  } catch (err) {
    console.error("❌ URL registration failed:", err.response?.data || err.message);
    res
      .status(500)
      .json({ error: "URL registration failed", details: err.response?.data || err.message });
  }
});

// 💳 STK Push Endpoint
app.post("/stkpush", async (req, res) => {
  try {
    const { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone and amount are required" });
    }

    const access_token = await getAccessToken();
    const timestamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
    const password = Buffer.from(
      `${process.env.SHORTCODE}${process.env.PASSKEY}${timestamp}`
    ).toString("base64");

    const stkRequest = {
      BusinessShortCode: process.env.SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.TILL_NUMBER,
      PhoneNumber: phone,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: "",
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
      message: "📲 𝐂𝐇𝐄𝐂𝐊 𝐘𝐎𝐔𝐑 𝐏𝐇𝐎𝐍𝐄 𝐓𝐎 𝐂𝐎𝐌𝐏𝐋𝐄𝐓𝐄 𝐏𝐀𝐘𝐌𝐄𝐍𝐓",
      data: response.data,
    });
  } catch (err) {
    const errorDetails = err.response?.data || err.message;
    console.error("❌ STK push failed:", errorDetails);
    res
      .status(500)
      .json({ error: "STK Push failed", details: errorDetails });
  }
});

// 📞 M-PESA Callback Handler
app.post("/mpesa/callback", async (req, res) => {
  const callback = req.body?.Body?.stkCallback;
  console.log("📞 M-PESA Callback Received:\n", JSON.stringify(callback, null, 2));

  if (callback?.ResultCode === 0) {
    console.log("✅ Payment Successful");

    const phone = callback.CallbackMetadata?.Item?.find(i => i.Name === "PhoneNumber")?.Value;
    const amount = callback.CallbackMetadata?.Item?.find(i => i.Name === "Amount")?.Value;

    try {
      const response = await sms.send({
        to: [phone],
        message: `Your payment of KES ${amount} was successful. Bundles delivered. Thank you for using our service!`,
      });
      console.log("📩 SMS Sent:", response);
    } catch (smsErr) {
      console.error("❌ SMS sending failed:", smsErr);
    }
  } else {
    console.log(`❌ Payment Failed: ${callback?.ResultDesc}`);
  }

  res.sendStatus(200);
});

// 📥 C2B Confirmation URL
app.post("/mpesa/confirmation", (req, res) => {
  console.log("📥 Confirmation Data:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

// 📥 C2B Validation URL
app.post("/mpesa/validation", (req, res) => {
  console.log("📥 Validation Data:", JSON.stringify(req.body, null, 2));
  res.json({
    ResultCode: 0,
    ResultDesc: "Accepted",
  });
});

// 🚀 Start Server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});