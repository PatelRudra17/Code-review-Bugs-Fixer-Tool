import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(currentDir, "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, "");
  const apiProxyTarget =
    env.VITE_API_PROXY_TARGET ||
    env.VITE_API_BASE_URL ||
    `http://127.0.0.1:${env.PORT || "5051"}`;

  return {
    envDir: workspaceRoot,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: Number(env.VITE_DEV_PORT || 5173),
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
