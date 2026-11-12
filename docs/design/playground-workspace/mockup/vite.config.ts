import { defineConfig } from "vite";
export default defineConfig({
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "@radix-ui/react-slot",
      "@radix-ui/react-tabs",
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
    ],
  },
  build: { outDir: "dist" },
});
