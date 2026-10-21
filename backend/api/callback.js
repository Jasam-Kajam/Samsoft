
"use strict";

const { getDb, FieldValue } = require("./_lib/firebaseAdmin");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method Not Allowed"
    });
  }

  const callback = req.body?.Body?.stkCallback;

  if (
    !callback ||
    typeof callback.CheckoutRequestID !== "string" ||
    callback.CheckoutRequestID.length > 200 ||
    callback.ResultCode === undefined ||
    callback.ResultCode === null
  ) {
    console.error("Invalid STK callback payload");

    return res.status(400).json({
      ResultCode: 1,
      ResultDesc: "Invalid callback payload"
    });
  }

  const checkoutRequestId = callback.CheckoutRequestID;
  const resultCode = Number(callback.ResultCode);

  if (!Number.isInteger(resultCode)) {
    return res.status(400).json({
      ResultCode: 1,
      ResultDesc: "Invalid result code"
    });
  }

  const status = resultCode === 0
    ? "SUCCESS"
    : resultCode === 1032
      ? "CANCELLED"
      : "FAILED";

  const metadata = {};

  for (const item of callback.CallbackMetadata?.Item || []) {
    if (item.Name) {
      metadata[item.Name] = item.Value ?? null;
    }
  }

  try {
    const db = getDb();
    const ref = db
      .collection("quicktelPayments")
      .doc(checkoutRequestId);

    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const existing = snapshot.exists ? snapshot.data() : {};

      // Do not let a duplicate or delayed callback overwrite a final result.
      const alreadyTerminal = [
        "SUCCESS",
        "CANCELLED",
        "FAILED"
      ].includes(existing.status);

      if (alreadyTerminal) {
        console.warn("Duplicate terminal callback ignored", {
          checkoutRequestId,
          existingStatus: existing.status,
          incomingStatus: status
        });
        return;
      }

      const payment = {
        checkoutRequestId,
        merchantRequestId:
          callback.MerchantRequestID ||
          existing.merchantRequestId ||
          null,
        status,
        resultCode,
        resultDescription: callback.ResultDesc || "",
        callbackReceivedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
      };

      if (metadata.Amount !== undefined) {
        payment.amount = metadata.Amount;
      }

      if (metadata.MpesaReceiptNumber !== undefined) {
        payment.mpesaReceiptNumber = metadata.MpesaReceiptNumber;
      }

      if (metadata.PhoneNumber !== undefined) {
        payment.phoneNumber = String(metadata.PhoneNumber);
      }

      if (metadata.TransactionDate !== undefined) {
        payment.transactionDate = metadata.TransactionDate;
      }

      transaction.set(ref, payment, { merge: true });
    });

    console.log("Quicktel payment callback processed", {
      checkoutRequestId,
      status,
      resultCode
    });

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback processed"
    });
  } catch (error) {
    console.error(
      "Failed to save payment callback:",
      error.message
    );

    return res.status(500).json({
      ResultCode: 1,
      ResultDesc: "Unable to save callback"
    });
  }
};
