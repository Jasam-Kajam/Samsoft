export default function handler(req, res) {
  if (req.method === "POST") {
    console.log("Validation Payload:", req.body);

    // Example logic: accept all transactions
    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted"
    });

    // Or apply custom rules:
    // let resultCode = req.body.Amount <= 10000 ? 0 : 1;
    // let resultDesc = resultCode === 0 ? "Accepted" : "Rejected";
    // res.status(200).json({ ResultCode: resultCode, ResultDesc: resultDesc });
  } else {
    res.status(405).send("Method Not Allowed");
  }
}