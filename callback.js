// api/callback.js
//
// Safaricom M-PESA STK Push Callback
// Endpoint:
// https://samsoft-coral.vercel.app/callback

export default async function handler(req, res) {
  // Safaricom sends callbacks using POST
  if (req.method !== "POST") {
    return res.status(405).json({
      ResultCode: 1,
      ResultDesc: "Method not allowed"
    });
  }

  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback) {
      console.error("Invalid M-PESA callback:", req.body);

      return res.status(400).json({
        ResultCode: 1,
        ResultDesc: "Invalid callback data"
      });
    }

    const {
      MerchantRequestID,
      CheckoutRequestID,
      ResultCode,
      ResultDesc,
      CallbackMetadata
    } = callback;

    // Log the basic transaction response
    console.log("========== M-PESA CALLBACK ==========");
    console.log("MerchantRequestID:", MerchantRequestID);
    console.log("CheckoutRequestID:", CheckoutRequestID);
    console.log("ResultCode:", ResultCode);
    console.log("ResultDesc:", ResultDesc);

    // ---------------------------------------------------------
    // SUCCESSFUL PAYMENT
    // ---------------------------------------------------------

    if (Number(ResultCode) === 0) {
      const metadata = {};

      const items = CallbackMetadata?.Item || [];

      for (const item of items) {
        if (item.Name) {
          metadata[item.Name] = item.Value;
        }
      }

      const payment = {
        merchantRequestId: MerchantRequestID || null,
        checkoutRequestId: CheckoutRequestID || null,

        amount: metadata.Amount ?? null,
        mpesaReceiptNumber:
          metadata.MpesaReceiptNumber ?? null,

        transactionDate:
          metadata.TransactionDate ?? null,

        phoneNumber:
          metadata.PhoneNumber ?? null
      };

      console.log("========== PAYMENT SUCCESS ==========");
      console.log(JSON.stringify(payment, null, 2));

      /*
       * IMPORTANT:
       *
       * This is where you should update your Quicktel order.
       *
       * Example:
       *
       * 1. Find the order using CheckoutRequestID.
       * 2. Confirm ResultCode === 0.
       * 3. Save the M-PESA receipt number.
       * 4. Mark the order as PAID.
       * 5. Deliver the purchased bundle.
       *
       * Do NOT trust the customer's browser to confirm payment.
       * The Safaricom callback should be the source of truth.
       */

    } else {
      // -------------------------------------------------------
      // FAILED / CANCELLED PAYMENT
      // -------------------------------------------------------

      console.log("========== PAYMENT FAILED ==========");
      console.log("ResultCode:", ResultCode);
      console.log("ResultDesc:", ResultDesc);

      /*
       * Here you can update the corresponding order as:
       *
       * pending -> failed
       *
       * The CheckoutRequestID can be used to identify the order.
       */
    }

    // ---------------------------------------------------------
    // RESPONSE TO SAFARICOM
    // ---------------------------------------------------------

    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback received successfully"
    });

  } catch (error) {
    console.error("M-PESA callback error:", error);

    // Return a valid HTTP response even if processing fails.
    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Callback received"
    });
  }
}

Register this URL in Daraja

Use:

https://samsoft-coral.vercel.app/callback

The endpoint will receive:

POST /callback

One important point: this callback receives the payment notification, but it does not yet connect the payment to your Quicktel order or automatically deliver the bundle. For your Quicktel system, the next step should be connecting this callback to your existing payment/order structure so that a successful Safaricom payment changes the order to PAID and triggers the bundle delivery.