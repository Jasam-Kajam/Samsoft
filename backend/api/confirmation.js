export default function handler(req, res) {
  if (req.method === "POST") {
    console.log("Confirmation Payload:", req.body);

    // Here you can save transaction details to your database
    // Example: console.log("Transaction saved:", req.body);

    res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted"
    });
  } else {
    res.status(405).send("Method Not Allowed");
  }
}