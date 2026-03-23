async function postAnthropicMessage(req, res) {
  const { apiKey, payload } = req.body || {};

  if (!apiKey || !String(apiKey).trim()) {
    return res.status(400).json({ message: "Anthropic API key is required." });
  }

  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ message: "A valid Anthropic payload is required." });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": String(apiKey).trim(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        message:
          data?.error?.message ||
          data?.message ||
          `Anthropic request failed with status ${response.status}.`,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ message: error.message || "Anthropic proxy request failed." });
  }
}

module.exports = {
  postAnthropicMessage,
};
