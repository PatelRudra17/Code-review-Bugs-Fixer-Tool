const mongoose = require("mongoose");

async function connectMongo() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.warn("MongoDB URI not set. Server will continue with in-memory storage.");
    return false;
  }

  try {
    await mongoose.connect(uri);
    console.log("MongoDB connected.");
    return true;
  } catch (error) {
    console.error("MongoDB connection failed. Falling back to in-memory storage.");
    console.error(error.message);
    return false;
  }
}

function isMongoReady() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  connectMongo,
  isMongoReady,
  mongoose,
};
