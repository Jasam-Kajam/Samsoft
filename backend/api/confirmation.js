// File: /pages/api/c2b/confirmation.js

export default function handler(req, res) {
  if (req.method === "POST") {
    const data = req.body;

    console.log("✅ C2B Confirmation Received:", data);

    // Echo back the same data in response (for testing)
    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Confirmation Received Successfully",
      Echo: data, // Safaricom payload echoed back
    });
  } else {
    return res.status(405).json({
      message: "Method Not Allowed",
    });
  }
}