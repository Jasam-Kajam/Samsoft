export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  const body = req.body || {};
  const callback = body.Body?.stkCallback;

  if (!callback) {
    console.error("Invalid STK callback payload");

    return res.status(400).json({
      error: "Invalid callback payload"
    });
  }

  const {
    MerchantRequestID,
    CheckoutRequestID,
    ResultCode,
    ResultDesc,
    CallbackMetadata
  } = callback;

  const metadata = {};

  for (const item of CallbackMetadata?.Item || []) {
    metadata[item.Name] = item.Value;
  }

  console.log("STK Push result received", {
    MerchantRequestID,
    CheckoutRequestID,
    ResultCode,
    ResultDesc,
    Amount: metadata.Amount,
    MpesaReceiptNumber: metadata.MpesaReceiptNumber,
    PhoneNumber: metadata.PhoneNumber,
    TransactionDate: metadata.TransactionDate
  });

  if (Number(ResultCode) === 0) {
    console.log("Payment reported successful by Safaricom.");
    // TODO: Save the verified payment and activate the purchased bundle.
  } else {
    console.log("Payment unsuccessful or cancelled.");
    // TODO: Update the associated order as unsuccessful.
  }

  return res.status(200).json({
    ResultCode: 0,
    ResultDesc: "Callback received"
  });
}