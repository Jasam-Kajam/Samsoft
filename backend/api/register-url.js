import axios from "axios";

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
  ).toString("base64");

  const response = await axios.get(
    "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
    {
      headers: { Authorization: `Basic ${auth}` },
    }
  );
  return response.data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const accessToken = await getAccessToken();

    const registerPayload = {
      ShortCode: process.env.SHORTCODE,
      ResponseType: "Completed",
      ConfirmationURL: `${process.env.BASE_URL}/api/confirmation`,
      ValidationURL: `${process.env.BASE_URL}/api/validation`,
    };

    const response = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/registerurl",
      registerPayload,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    res.status(200).json({
      message: "✅ M-PESA URLs registered successfully (Sandbox)",
      data: response.data,
    });
  } catch (err) {
    console.error("❌ URL registration failed:", err.response?.data || err.message);
    res.status(500).json({
      error: "URL registration failed",
      details: err.response?.data || err.message,
    });
  }
}