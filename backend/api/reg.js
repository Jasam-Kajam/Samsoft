import axios from "axios";

async function getAccessToken() {
  if (!process.env.CONSUMER_KEY || !process.env.CONSUMER_SECRET) {
    throw new Error("❌ Missing CONSUMER_KEY or CONSUMER_SECRET in env.");
  }

  const auth = Buffer.from(
    `${process.env.CONSUMER_KEY}:${process.env.CONSUMER_SECRET}`
  ).toString("base64");

  // Sandbox access token URL
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

    if (!process.env.SHORTCODE) {
      throw new Error("❌ Missing SHORTCODE in env.");
    }

    const registerPayload = {
      ShortCode: process.env.SHORTCODE,
      ResponseType: "Completed",
      ConfirmationURL: "https://samsoft-coral.vercel.app/api/confirmation",
      ValidationURL: "https://samsoft-coral.vercel.app/api/validation",
    };

    // Sandbox C2B URL registration
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