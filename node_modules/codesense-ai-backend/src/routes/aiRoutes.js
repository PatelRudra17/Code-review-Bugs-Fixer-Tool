const express = require("express");
const { postAnthropicMessage } = require("../controllers/aiController");

const router = express.Router();

router.post("/messages", postAnthropicMessage);

module.exports = router;
