import { defineConfig } from "vitest/config";

// Config separada para los tests: usa la raíz del proyecto (no /web),
// así encuentra test/ y src/.
export default defineConfig({
  root: __dirname,
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
