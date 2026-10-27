import { defineConfig } from "vite-plus";
import "vite-plus/test/config";

export default defineConfig({
  test: {
    name: "mobile",
    // Compiling every source file through Metro's Babel config is slow on a loaded machine.
    testTimeout: 60_000,
    include: ["**/*.test.{ts,tsx,mts}"],
    exclude: ["**/node_modules/**", "android/**"],
  },
});
