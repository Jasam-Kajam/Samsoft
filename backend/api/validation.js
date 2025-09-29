// File: /pages/api/c2b/validation.js

export const config = {
  api: {
    bodyParser: true, // ensure JSON body is parsed
  },
};

export default function handler(req, res) {
  if (req.method === "POST") {
    try {
      const data = req.body || {};

      console.log("📩 C2B Validation Request Received:", JSON.stringify(data, null, 2));

      /**
       * Business logic goes here:
       * - Check if the account number / MSISDN exists
       * - Check if the amount is within limits
       * - Check if payment is allowed for this shortcode
       *
       * If VALID → return ResultCode: 0
       * If INVALID → return ResultCode: C2B_ERROR_CODE (e.g., 1)
       */

      const isValid = true; // replace with your own checks

      if (isValid) {
        return res.status(200).json({
          ResultCode: 0,
          ResultDesc: "Validation Passed Successfully",
        });
      } else {
        return res.status(200).json({
          ResultCode: 1,
          ResultDesc: "Validation Failed - Invalid Account or Amount",
        });
      }
    } catch (err) {
      console.error("❌ Error in validation handler:", err);
      return res.status(500).json({
        ResultCode: 1,
        ResultDesc: "Internal Server Error",
      });
    }
  } else {
    return res.status(405).json({
      message: "Method Not Allowed",
    });
  }
}