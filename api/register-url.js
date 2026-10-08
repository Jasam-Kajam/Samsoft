export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        success: false,
        message: "Use POST /api/register-url"
      });
    }

    const {
      CONSUMER_KEY,
      CONSUMER_SECRET,
      SHORTCODE
    } = process.env;

    if (!CONSUMER_KEY) {
      return res.status(500).json({
        success: false,
        message: "CONSUMER_KEY is missing"
      });
    }

    if (!CONSUMER_SECRET) {
      return res.status(500).json({
        success: false,
        message: "CONSUMER_SECRET is missing"
      });
    }

    if (!SHORTCODE) {
      return res.status(500).json({
        success: false,
        message: "SHORTCODE is missing"
      });
    }

    const credentials = Buffer
      .from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`)
      .toString("base64");

    const tokenResponse = await fetch(
      "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
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
        raw: tokenText
      };
    }

    if (!tokenResponse.ok) {
      return res.status(502).json({
        success: false,
        message: "Safaricom token request failed",
        response: tokenData
      });
    }

    if (!tokenData.access_token) {
      return res.status(502).json({
        success: false,
        message: "Safaricom did not return an access token",
        response: tokenData
      });
    }

    const callbackURL =
      "https://samsoft-coral.vercel.app/api/callback";

    const registerResponse = await fetch(
      "https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ShortCode: SHORTCODE,
          ResponseType: "Completed",
          ConfirmationURL: callbackURL,
          ValidationURL: callbackURL
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
        raw: registerText
      };
    }

    return res.status(
      registerResponse.ok ? 200 : registerResponse.status
    ).json({
      success: registerResponse.ok,
      message: registerResponse.ok
        ? "Register URL request completed"
        : "Safaricom rejected the registration",
      response: registerData
    });

  } catch (error) {
    console.error("REGISTER URL ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Function execution failed",
      error: error.message
    });
  }
}