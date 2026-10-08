export default function handler(req, res) {
  console.log("REGISTER URL FUNCTION STARTED");
  console.log("METHOD:", req.method);

  return res.status(200).json({
    success: true,
    message: "Vercel function is working",
    method: req.method,
    environment: {
      consumerKey: !!process.env.CONSUMER_KEY,
      consumerSecret: !!process.env.CONSUMER_SECRET,
      shortcode: !!process.env.SHORTCODE
    }
  });
}