export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const consumerKey = process.env.CONSUMER_KEY;
        const consumerSecret = process.env.CONSUMER_SECRET;

        if (!consumerKey || !consumerSecret) {
            return res.status(500).json({
                error: "M-PESA credentials are not configured"
            });
        }

        const credentials = Buffer
            .from(`${consumerKey}:${consumerSecret}`)
            .toString("base64");

        const response = await fetch(
            "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
            {
                method: "GET",
                headers: {
                    Authorization: `Basic ${credentials}`
                }
            }
        );

        const data = await response.json();

        if (!response.ok) {
            return res.status(response.status).json(data);
        }

        return res.status(200).json({
            access_token: data.access_token,
            expires_in: data.expires_in
        });

    } catch (error) {
        console.error("Access token error:", error);

        return res.status(500).json({
            error: "Failed to generate access token"
        });
    }
}