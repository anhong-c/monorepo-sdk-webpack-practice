const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const webpack = require("webpack");
const webpackConfig = require("../webpack.config.cjs");

const appRoot = path.resolve(__dirname, "..");
const sdkRoot = path.resolve(appRoot, "../sdk");

function compileApp(t, plugins = webpackConfig.plugins) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const outputPath = fs.mkdtempSync(path.join(tempRoot, "source-exports-test-"));
  t.after(() => {
    assert.equal(path.dirname(outputPath), tempRoot);
    assert.ok(path.basename(outputPath).startsWith("source-exports-test-"));
    fs.rmSync(outputPath, { recursive: true, force: true, maxRetries: 3 });
  });

  return new Promise((resolve, reject) => {
    const compiler = webpack({
      ...webpackConfig,
      mode: "none",
      plugins,
      optimization: { concatenateModules: false, minimize: false },
      output: { ...webpackConfig.output, path: outputPath },
    });

    compiler.run((error, result) => {
      compiler.close((closeError) => {
        if (error || closeError) {
          reject(error ?? closeError);
        } else {
          resolve(result.toJson({ all: false, errors: true, modules: true }));
        }
      });
    });
  });
}

test("exports exposes public subpaths and blocks SDK internals", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(sdkRoot, "package.json"), "utf8"),
  );

  assert.equal(
    packageJson.exports["./component-a"].source,
    "./src/modules/ui/component-a/label.ts",
  );
  assert.equal(
    packageJson.exports["./component-b"].source,
    "./src/modules/ui/component-b/summary.ts",
  );
  assert.equal(packageJson.exports["./src/internal/constants"], undefined);
  assert.throws(
    () => require.resolve("@practice/sdk/src/internal/constants", { paths: [appRoot] }),
    (error) => error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  );
});

test("Webpack source condition bundles SDK src instead of dist", async (t) => {
  const result = await compileApp(t);
  const moduleNames = result.modules.map((module) => module.name ?? "");

  assert.deepEqual(result.errors, []);
  assert.ok(moduleNames.some((name) => name.includes("sdk/src/modules/ui/component-a/label.ts")));
  assert.ok(moduleNames.some((name) => name.includes("sdk/src/modules/ui/component-b/summary.ts")));
  assert.ok(moduleNames.some((name) => name.includes("sdk/src/math/index.ts")));
  assert.ok(!moduleNames.some((name) => name.includes("sdk/dist/")));
});

test("the real App build needs MyAliasPlugin for SDK internal aliases", async (t) => {
  const result = await compileApp(t, []);

  assert.ok(result.errors.some((error) => error.message.includes("@sdk/math")));
});
