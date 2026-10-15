export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  const payload = req.body || {};

  console.log("C2B payment confirmation received", {
    TransID: payload.TransID,
    TransAmount: payload.TransAmount,
    BillRefNumber: payload.BillRefNumber,
    TransTime: payload.TransTime,
    BusinessShortCode: payload.BusinessShortCode
  });

  // Acknowledge receipt.
  return res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Confirmation received"
  });
}