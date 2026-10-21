
import { getDb, FieldValue } from "./_lib/firebaseAdmin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  const callback = req.body?.Body?.stkCallback;

  if (!callback) {
    console.error("Invalid STK callback payload");

    // Acknowledge the callback to avoid unnecessary retries.
    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback acknowledged"
    });
  }

  const {
    CheckoutRequestID,
    MerchantRequestID,
    ResultCode,
    ResultDesc,
    CallbackMetadata
  } = callback;

  if (!CheckoutRequestID) {
    console.error("Callback missing CheckoutRequestID");

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback acknowledged"
    });
  }

  const status =
    Number(ResultCode) === 0
      ? "SUCCESS"
      : Number(ResultCode) === 1032
        ? "CANCELLED"
        : "FAILED";

  const metadata = {};

  for (const item of CallbackMetadata?.Item || []) {
    if (item.Name) {
      metadata[item.Name] = item.Value ?? null;
    }
  }

  const payment = {
    checkoutRequestId: CheckoutRequestID,
    merchantRequestId: MerchantRequestID || null,
    status,
    resultCode: Number(ResultCode),
    resultDescription: ResultDesc || "",
    amount: metadata.Amount ?? null,
    mpesaReceiptNumber: metadata.MpesaReceiptNumber ?? null,
    phoneNumber: metadata.PhoneNumber ?? null,
    transactionDate: metadata.TransactionDate ?? null,
    callbackReceivedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  };

  try {
    const db = getDb();

    await db
      .collection("quicktelPayments")
      .doc(CheckoutRequestID)
      .set(payment, { merge: true });

    console.log("Quicktel payment saved:", {
      checkoutRequestId: CheckoutRequestID,
      status,
      resultCode: ResultCode
    });

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback saved successfully"
    });
  } catch (error) {
    console.error("Failed to save payment callback:", error.message);

    // Report the storage failure so it can be investigated.
    return res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Unable to save callback"
    });
  }
}
