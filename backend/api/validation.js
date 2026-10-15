export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ResultCode: 1,
      ResultDesc: "Method Not Allowed"
    });
  }

  const payload = req.body || {};

  console.log("C2B validation received", {
    TransID: payload.TransID,
    TransAmount: payload.TransAmount,
    BillRefNumber: payload.BillRefNumber
  });

  // Accept the payment request.
  return res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Accepted"
  });
}