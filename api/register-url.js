// api/register-url.js
//
// Safaricom Daraja C2B Register URL
//
// Endpoint:
// POST https://samsoft-coral.vercel.app/api/register-url
//
// Vercel Environment Variables:
// CONSUMER_KEY
// CONSUMER_SECRET
// SHORTCODE

export default async function handler(req, res) {

  // --------------------------------------------------
  // METHOD CHECK
  // --------------------------------------------------

  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed. Send a POST request."
    });
  }

  try {

    // --------------------------------------------------
    // ENVIRONMENT VARIABLES
    // --------------------------------------------------

    const {
      CONSUMER_KEY,
      CONSUMER_SECRET,
      SHORTCODE
    } = process.env;

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

    // --------------------------------------------------
    // SAFARICOM PRODUCTION API
    // --------------------------------------------------

    const BASE_URL = "https://api.safaricom.co.ke";

    // --------------------------------------------------
    // GENERATE ACCESS TOKEN
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

    const tokenText = await tokenResponse.text();

    let tokenData;

    try {
      tokenData = JSON.parse(tokenText);
    } catch {
      tokenData = {
        rawResponse: tokenText
      };
    }

    if (!tokenResponse.ok || !tokenData.access_token) {

      console.error(
        "Safaricom OAuth error:",
        tokenData
      );

      return res.status(502).json({
        success: false,
        message: "Failed to obtain Safaricom access token.",
        safaricom: tokenData
      });
    }

    // --------------------------------------------------
    // CALLBACK URLS
    // --------------------------------------------------

    const confirmationURL =
      "https://samsoft-coral.vercel.app/api/callback";

    const validationURL =
      "https://samsoft-coral.vercel.app/api/callback";

    // --------------------------------------------------
    // REGISTER C2B URLS
    // --------------------------------------------------

    const registerResponse = await fetch(
      `${BASE_URL}/mpesa/c2b/v2/registerurl`,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${tokenData.access_token}`,

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

    const registerText =
      await registerResponse.text();

    let registerData;

    try {
      registerData = JSON.parse(registerText);
    } catch {
      registerData = {
        rawResponse: registerText
      };
    }

    console.log(
      "Safaricom Register URL response:",
      registerData
    );

    // --------------------------------------------------
    // SAFARICOM RESPONSE
    // --------------------------------------------------

    if (!registerResponse.ok) {
      return res.status(registerResponse.status).json({
        success: false,
        message:
          "Safaricom rejected the URL registration.",
        safaricom: registerData
      });
    }

    return res.status(200).json({
      success: true,
      message:
        "Safaricom URLs registered successfully.",

      shortcode: SHORTCODE,

      confirmationURL,

      validationURL,

      safaricom: registerData
    });

  } catch (error) {

    console.error(
      "Register URL error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message
    });
  }
}