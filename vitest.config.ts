import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Contract-test config: the ledger drift guards are pure node tests that read
// the checked-in artifact and the apps/web sources it derives from.
export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" -> "./*" path mapping (apps/test-ledger root).
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
