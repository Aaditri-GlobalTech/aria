import tailwindcss from "@tailwindcss/vite";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [solid(), tailwindcss()],
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
    reporters: ["verbose"],
  },
});
