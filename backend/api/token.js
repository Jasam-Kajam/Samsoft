// tokenServer.js
const express = require("express");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// ==========================
// Generate Access Token (LIVE)
// ==========================
async function generateAccessToken() {
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
    throw new Error(error.response?.data?.errorMessage || error.message);
  }
}

// ==========================
// API Endpoint
// ==========================
app.get("/token", async (req, res) => {
  try {
    const token = await generateAccessToken();
    res.json({ access_token: token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================
// Start Server
// ==========================
app.listen(port, () => {
  console.log(`🚀 Token server running at http://localhost:${port}/token`);
});