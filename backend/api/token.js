// api/token.js
import axios from "axios";

export default async function handler(req, res) {
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

    return res.status(200).json({
      access_token: response.data.access_token,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.response?.data || error.message,
    });
  }
}