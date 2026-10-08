// api/register-url.js
//
// Safaricom Daraja C2B Register URL
//
// Endpoint:
// https://samsoft-coral.vercel.app/api/register-url
//
// Environment variables required:
// CONSUMER_KEY
// CONSUMER_SECRET
// SHORTCODE

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed. Use POST."
    });
  }

  try {
    const {
      CONSUMER_KEY,
      CONSUMER_SECRET,
      SHORTCODE
    } = process.env;

    // Check environment variables
    if (!CONSUMER_KEY) {
      return res.status(500).json({
        success: false,
        message: "CONSUMER_KEY is missing."
      });
    }

    if (!CONSUMER_SECRET) {
      return res.status(500).json({
        success: false,
        message: "CONSUMER_SECRET is missing."
      });
    }

    if (!SHORTCODE) {
      return res.status(500).json({
        success: false,
        message: "SHORTCODE is missing."
      });
    }

    // Safaricom production API
    const BASE_URL = "https://api.safaricom.co.ke";

    // --------------------------------------------------
    // 1. Generate OAuth Access Token
    // --------------------------------------------------

    const credentials = Buffer
      .from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`)
      .toString("base64");

    const tokenResponse = await fetch(
      `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${credentials}`
        }
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error(
        "Safaricom OAuth error:",
        tokenData
      );

      return res.status(500).json({
        success: false,
        message: "Failed to generate Safaricom access token.",
        safaricom: tokenData
      });
    }

    // --------------------------------------------------
    // 2. Callback URLs
    // --------------------------------------------------

    const confirmationURL =
      "https://samsoft-coral.vercel.app/api/callback";

    const validationURL =
      "https://samsoft-coral.vercel.app/api/callback";

    // --------------------------------------------------
    // 3. Register C2B URLs
    // --------------------------------------------------

    const registerResponse = await fetch(
      `${BASE_URL}/mpesa/c2b/v2/registerurl`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          ShortCode: SHORTCODE,
          ResponseType: "Completed",
          ConfirmationURL: confirmationURL,
          ValidationURL: validationURL
        })
      }
    );

    const registerData = await registerResponse.json();

    console.log(
      "Safaricom Register URL response:",
      registerData
    );

    // --------------------------------------------------
    // 4. Return Safaricom response
    // --------------------------------------------------

    if (!registerResponse.ok) {
      return res.status(registerResponse.status).json({
        success: false,
        message: "Safaricom rejected the URL registration.",
        safaricom: registerData
      });
    }

    return res.status(200).json({
      success: true,
      message: "Safaricom URLs registered successfully.",
      shortcode: SHORTCODE,
      confirmationURL,
      validationURL,
      safaricom: registerData
    });

  } catch (error) {
    console.error(
      "Register URL server error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message
    });
  }
}