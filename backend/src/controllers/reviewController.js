const reviewStore = require("../services/reviewStore");

async function createReview(req, res) {
  const { fileName, mode } = req.body || {};

  if (!fileName || !mode) {
    return res.status(400).json({ message: "fileName and mode are required." });
  }

  try {
    const review = await reviewStore.createReview(req.body || {});
    return res.status(201).json({ review });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to create review." });
  }
}

async function listReviews(req, res) {
  try {
    const reviews = await reviewStore.listReviews(req.query.workspaceId || null);
    return res.json({ reviews });
  } catch (error) {
    return res.status(500).json({ message: error.message || "Failed to list reviews." });
  }
}

module.exports = {
  createReview,
  listReviews,
};
