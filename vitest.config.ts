import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Contract-test config: the proof drift guards are pure node tests that read
// the checked-in artifact and the apps/web sources it derives from.
export default defineConfig({
  resolve: {
    alias: {
      // Mirror the tsconfig "@/*" -> "./*" path mapping (specproof root).
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    // example/ holds fixture tests for the analyzer to parse — never run them
    exclude: ["node_modules/**", ".next/**", "example/**"],
  },
});
