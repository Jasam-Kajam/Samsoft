export default async function handler(req, res) {
  // Accept POST requests only.
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  try {
    const body = req.body || {};
    const callback = body.Body?.stkCallback;

    if (!callback) {
      console.error("Invalid STK callback payload");

      // Acknowledge the request to avoid unnecessary retries.
      return res.status(200).json({
        ResultCode: 0,
        ResultDesc: "Acknowledged"
      });
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata
    } = callback;

    // Extract payment metadata when available.
    const metadata = {};

    for (const item of CallbackMetadata?.Item || []) {
      metadata[item.Name] = item.Value;
    }

    const resultCode = Number(ResultCode);

    // Prepare a structured transaction result.
    const transaction = {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode: resultCode,
      ResultDesc,
      Amount: metadata.Amount ?? null,
      MpesaReceiptNumber:
        metadata.MpesaReceiptNumber ?? null,
      PhoneNumber: metadata.PhoneNumber ?? null,
      TransactionDate:
        metadata.TransactionDate ?? null,
      Status:
        resultCode === 0
          ? "SUCCESS"
          : resultCode === 1032
            ? "CANCELLED"
            : "FAILED"
    };

    console.log(
      "Quicktel STK payment result:",
      JSON.stringify(transaction)
    );

    if (resultCode === 0) {
      console.log("Payment successful.");

      // TODO:
      // Save the verified payment to your database.
      // Match CheckoutRequestID to the pending order.
      // Activate the purchased bundle only after verification.
    } else if (resultCode === 1032) {
      console.log("Customer cancelled the STK Push.");

      // TODO:
      // Update the matching order to CANCELLED.
    } else {
      console.log("Payment failed:", ResultDesc);

      // TODO:
      // Update the matching order to FAILED.
    }

    // Acknowledge receipt of Safaricom's callback.
    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback received successfully"
    });

  } catch (error) {
    console.error("STK callback processing error:", error);

    return res.status(500).json({
      error: "Callback processing failed"
    });
  }
}