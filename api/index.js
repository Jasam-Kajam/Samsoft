const axios = require("axios");

async function getAccessToken() {
  try {
    const auth = Buffer.from(
      `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
    ).toString("base64");

    const response = await axios.get(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: { Authorization: `Basic ${auth}` },
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

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const { phone, amount } = req.body;

    if (!phone || !amount)
      return res.status(400).json({ error: "Phone and amount are required" });

    const access_token = await getAccessToken();

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, "")
      .slice(0, 14);

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
      PartyB: process.env.SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: process.env.CALLBACK_URL,
      AccountReference: "Quicktel",
      TransactionDesc: "BUNDLES",
    };

    const response = await axios.post(
      "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest",
      stkRequest,
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    res.status(200).json({
      message: "CONFIRM PAYMENT ON YOUR PHONE",
      data: response.data,
    });
  } catch (err) {
    const errorDetails = err.response?.data || err.message;
    console.error("❌ STK push failed:", errorDetails);
    res.status(500).json({ error: "STK Push failed", details: errorDetails });
  }
}