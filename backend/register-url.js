
/**
 * Quicktel Bundles
 * Safaricom Daraja C2B Register URL
 * Production deployment: Vercel
 *
 * Endpoint:
 * POST https://samsoft-coral.vercel.app/api/register-url
 */

export default async function handler(req, res) {
  // Allow POST requests only
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");

    return res.status(405).json({
      success: false,
      message: "Method not allowed. Use POST."
    });
  }

  const {
    CONSUMER_KEY,
    CONSUMER_SECRET,
    SHORTCODE,
    ADMIN_SECRET
  } = process.env;

  // Require server configuration
  if (
    !CONSUMER_KEY ||
    !CONSUMER_SECRET ||
    !SHORTCODE ||
    !ADMIN_SECRET
  ) {
    return res.status(500).json({
      success: false,
      message: "Missing required Vercel environment variables."
    });
  }

  // Protect the registration endpoint
  const suppliedSecret = req.headers["x-admin-secret"];

  if (
    typeof suppliedSecret !== "string" ||
    suppliedSecret.length !== ADMIN_SECRET.length ||
    suppliedSecret !== ADMIN_SECRET
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized."
    });
  }

  // Public HTTPS endpoints
  const confirmationURL =
    "https://samsoft-coral.vercel.app/api/callback/confirmation";

  const validationURL =
    "https://samsoft-coral.vercel.app/api/callback/validation";

  const baseURL = "https://api.safaricom.co.ke";

  try {
    // 1. Generate Daraja access token
    const credentials = Buffer.from(
      `${CONSUMER_KEY}:${CONSUMER_SECRET}`
    ).toString("base64");

    const tokenResponse = await fetch(
      `${baseURL}/oauth/v1/generate?grant_type=client_credentials`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: "application/json"
        }
      }
    );

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error(
        "Daraja token request failed:",
        tokenResponse.status
      );

      return res.status(502).json({
        success: false,
        message: "Could not obtain a Daraja access token."
      });
    }

    // 2. Register C2B URLs with Safaricom
    const registerResponse = await fetch(
      `${baseURL}/mpesa/c2b/v2/registerurl`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
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

    if (!registerResponse.ok) {
      console.error(
        "Daraja registration failed:",
        registerResponse.status,
        registerData
      );

      return res.status(502).json({
        success: false,
        message: "Safaricom rejected the registration request.",
        status: registerResponse.status,
        data: registerData
      });
    }

    return res.status(200).json({
      success: true,
      message: "Daraja registration request submitted.",
      shortcode: SHORTCODE,
      confirmationURL,
      validationURL,
      data: registerData
    });
  } catch (error) {
    console.error("Registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unexpected error while contacting Daraja."
    });
  }
}
