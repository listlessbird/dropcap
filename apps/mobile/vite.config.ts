import { defineConfig } from "vite-plus";
import "vite-plus/test/config";

export default defineConfig({
  test: {
    name: "mobile",
    include: ["**/*.test.{ts,tsx,mts}"],
    exclude: ["**/node_modules/**", "android/**"],
  },
});
