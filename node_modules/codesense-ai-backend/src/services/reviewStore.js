const crypto = require("crypto");
const { isMongoReady } = require("../config/db");
const ReviewSession = require("../models/ReviewSession");

const memoryReviews = [];

function makeId() {
  return crypto.randomUUID();
}

async function createReview(payload) {
  if (isMongoReady()) {
    const review = await ReviewSession.create(payload);
    return review.toObject();
  }

  const review = {
    _id: makeId(),
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  memoryReviews.unshift(review);
  return review;
}

async function listReviews(workspaceId) {
  if (isMongoReady()) {
    const query = workspaceId ? { workspaceId } : {};
    return ReviewSession.find(query).sort({ createdAt: -1 }).lean();
  }

  return memoryReviews.filter((review) => !workspaceId || review.workspaceId === workspaceId);
}

module.exports = {
  createReview,
  listReviews,
};
