// File: /pages/api/c2b/confirmation.js

export default async function handler(req, res) {
  if (req.method === "POST") {
    try {
      // Safaricom will send JSON data here
      const data = req.body;

      console.log("✅ C2B Confirmation Received:", data);

      // TODO: save the data into your DB if needed

      // Respond back to Safaricom with success
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Confirmation Received Successfully",
      });
    } catch (error) {
      console.error("❌ Error handling confirmation:", error);
      return res.status(500).json({
        ResultCode: 1,
        ResultDesc: "Internal Server Error",
      });
    }
  } else {
    // If Safaricom tries GET or other methods
    return res.status(405).json({
      message: "Method Not Allowed",
    });
  }
}