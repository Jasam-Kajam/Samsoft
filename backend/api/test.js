// /api/test-env.js
export default function handler(req, res) {
  res.json({
    key: process.env.CONSUMER_KEY || null,
    secret: process.env.CONSUMER_SECRET || null,
  });
}