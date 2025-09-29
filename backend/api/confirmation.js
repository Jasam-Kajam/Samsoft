// File: /pages/api/c2b/confirmation.js

export const config = {
  api: {
    bodyParser: true, // ensure JSON body is parsed
  },
};

export default function handler(req, res) {
  if (req.method === "POST") {
    try {
      const data = req.body || {};

      console.log("✅ C2B Confirmation Received:", JSON.stringify(data, null, 2));

      // Always respond with success so Safaricom doesn't retry
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Confirmation Received Successfully",
        Echo: data, // Optional: echo payload for debugging
      });
    } catch (err) {
      console.error("❌ Error in confirmation handler:", err);
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