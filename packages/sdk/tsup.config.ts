import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "component-a": "src/modules/ui/component-a/label.ts",
    "component-b": "src/modules/ui/component-b/summary.ts",
  },
  outDir: "dist",
  format: ["esm", "cjs"],
  target: "es2020",
  dts: true,
  sourcemap: true,
  splitting: false,
  minify: false,
  clean: true,
  outExtension({ format }) {
    return {
      js: format === "esm" ? ".js" : ".cjs",
    };
  },
});
