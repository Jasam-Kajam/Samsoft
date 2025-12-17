const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
  ).toString("base64");

  const { data } = await axios.get(
    "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    { headers: { Authorization: `Basic ${auth}` } }
  );

  return data.access_token;
}

app.post("/", async (req, res) => {
  try {
    let { phone, amount } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ error: "Phone and amount required" });
    }

    if (phone.startsWith("0")) phone = "254" + phone.slice(1);
    if (phone.startsWith("+")) phone = phone.slice(1);

    const token = await getAccessToken();

    const payload = {
      BusinessShortCode: process.env.TILL_NUMBER,
      TransactionType: "CustomerBuyGoodsOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: process.env.TILL_NUMBER,
      PhoneNumber: phone,
      CallBackURL: `${process.env.BASE_URL}/api/callback`,
      AccountReference: "Bundles",
      TransactionDesc: "Bundles Payment",
    };

    const response = await axios.post(
      "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      payload,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.json(response.data);
  } catch (err) {
    res.status(500).json({
      error: "STK Push failed",
      details: err.response?.data || err.message,
    });
  }
});

module.exports = app;