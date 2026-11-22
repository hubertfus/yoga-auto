import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/{test,tests}/**/*.test.{ts,tsx}", "**/src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    environment: "node",
  },
});
