const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const rootEnvPath = path.resolve(__dirname, "../../.env");
const serverEnvPath = path.resolve(__dirname, "../.env");

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else if (fs.existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
} else {
  dotenv.config();
}

const app = require("./app");
const { connectMongo } = require("./config/db");

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5051);

async function start() {
  await connectMongo();
  app.listen(port, host, () => {
    console.log(`CodeSense AI server running at http://${host}:${port}`);
  });
}

start();
