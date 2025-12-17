import axios from "axios";
import btoa from "btoa";

// === STEP 1: Enter your sandbox credentials ===
const consumerKey = "189PZFAVBiIv1e0hWTRuAWtPGR68YSkjmLhFSppwyVT1ePvd";
const consumerSecret = "rGwtyv8ANvgmunzMH7Gi1yy58dSfAdzd4Uucdq1ov61EnYNuivrZIJ72UYQVVhN4";

// Your Vercel endpoints
const validationURL = "https://samsoft-coral.vercel.app/api/validation";
const confirmationURL = "https://samsoft-coral.vercel.app/api/confirmation";

// Sandbox shortcode
const shortCode = "600000";

// === STEP 2: Generate access token ===
async function generateToken() {
  try {
    const auth = btoa(`${consumerKey}:${consumerSecret}`);
    const response = await axios.get(
      "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
      { headers: { Authorization: `Basic ${auth}` } }
    );
    return response.data.access_token;
  } catch (err) {
    console.error("Error generating access token:", err.response?.data || err.message);
  }
}

// === STEP 3: Register URLs ===
async function registerURLs() {
  const token = await generateToken();
  if (!token) return;

  try {
    const res = await axios.post(
      "https://sandbox.safaricom.co.ke/mpesa/c2b/v1/registerurl",
      {
        ShortCode: shortCode,
        ResponseType: "Completed",
        ConfirmationURL: confirmationURL,
        ValidationURL: validationURL
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Daraja URL Registration Response:", res.data);
  } catch (err) {
    console.error("Error registering URLs:", err.response?.data || err.message);
  }
}

// === Run the registration ===
registerURLs();