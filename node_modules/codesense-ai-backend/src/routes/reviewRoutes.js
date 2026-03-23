const express = require("express");
const { createReview, listReviews } = require("../controllers/reviewController");

const router = express.Router();

router.get("/", listReviews);
router.post("/", createReview);

module.exports = router;
