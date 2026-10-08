const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const webpack = require("webpack");
const MyAliasPlugin = require("./my-alias-plugin.cjs");

const componentPaths = {
  "@component-a/*": ["src/component-a/*"],
  "@component-b/*": ["src/component-b/*"],
};

function createFixture(t, paths = componentPaths) {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempRoot, "my-alias-plugin-test-"));
  const appRoot = path.join(root, "app");
  const sdkRoot = path.join(root, "sdk");
  fs.mkdirSync(appRoot);
  fs.mkdirSync(sdkRoot);
  const appPackage = { dependencies: { "@practice/sdk": "workspace:*" } };

  function writeAppPackage() {
    fs.writeFileSync(path.join(appRoot, "package.json"), JSON.stringify(appPackage));
  }

  function linkPackage(name, target) {
    const link = path.join(appRoot, "node_modules", ...name.split("/"));
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  }

  writeAppPackage();
  linkPackage("@practice/sdk", sdkRoot);
  fs.writeFileSync(
    path.join(sdkRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths } }),
  );
  fs.mkdirSync(path.join(appRoot, "src"));
  fs.writeFileSync(
    path.join(appRoot, "src/index.js"),
    'import a from "@component-a/label"; import b from "@component-b/summary"; console.log(a, b);',
  );

  for (const [component, file] of [["component-a", "label"], ["component-b", "summary"]]) {
    const directory = path.join(sdkRoot, "src", component);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${file}.js`), `export default "${component}";`);
  }

  t.after(() => {
    assert.equal(path.dirname(root), tempRoot);
    assert.ok(path.basename(root).startsWith("my-alias-plugin-test-"));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });

  return { appRoot, sdkRoot, root, appPackage, writeAppPackage, linkPackage };
}

function compile(appRoot) {
  return new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "none",
      target: "node",
      context: appRoot,
      entry: "./src/index.js",
      output: { path: path.join(appRoot, "dist"), filename: "app.cjs" },
      plugins: [new MyAliasPlugin({ rootDir: appRoot })],
    });

    compiler.run((error, stats) => {
      compiler.close((closeError) => {
        if (error || closeError) {
          reject(error ?? closeError);
        } else {
          resolve(stats.toJson({ all: false, errors: true, modules: true }));
        }
      });
    });
  });
}

test("one alias resolves component-a while only component-b fails", async (t) => {
  const fixture = createFixture(t, { "@component-a/*": componentPaths["@component-a/*"] });
  const stats = await compile(fixture.appRoot);
  assert.equal(stats.errors.length, 1);
  assert.match(stats.errors[0].message, /@component-b\/summary/);
  assert.ok(stats.modules.some((module) => module.name?.includes("component-a/label.js")));
});

test("both aliases let Webpack bundle workspace source modules", async (t) => {
  const fixture = createFixture(t);
  const stats = await compile(fixture.appRoot);
  assert.deepEqual(stats.errors, []);
  assert.ok(stats.modules.some((module) => module.name?.includes("component-a/label.js")));
  assert.ok(stats.modules.some((module) => module.name?.includes("component-b/summary.js")));
});

test("explicit Webpack aliases take precedence over generated aliases", (t) => {
  const fixture = createFixture(t);
  let callback;
  const compiler = {
    context: fixture.appRoot,
    options: { resolve: { alias: { "@component-a": "manual-target" } } },
    hooks: { afterEnvironment: { tap(_name, handler) { callback = handler; } } },
  };
  new MyAliasPlugin().apply(compiler);
  callback();
  assert.equal(compiler.options.resolve.alias["@component-a"], "manual-target");
  assert.equal(
    compiler.options.resolve.alias["@component-b"],
    path.join(fixture.sdkRoot, "src/component-b"),
  );
});

test("missing workspace installation gives an actionable error", (t) => {
  const fixture = createFixture(t);
  fixture.appPackage.dependencies["@practice/missing"] = "workspace:^";
  fixture.writeAppPackage();
  assert.throws(
    () => new MyAliasPlugin().readWorkspaceAliases(fixture.appRoot),
    /@practice\/missing.*pnpm install/,
  );
});

test("a workspace package without tsconfig is skipped", (t) => {
  const fixture = createFixture(t);
  fs.unlinkSync(path.join(fixture.sdkRoot, "tsconfig.json"));
  assert.deepEqual(new MyAliasPlugin().readWorkspaceAliases(fixture.appRoot), {});
});

test("workspace packages with conflicting aliases fail clearly", (t) => {
  const fixture = createFixture(t);
  const otherRoot = path.join(fixture.root, "other");
  fs.mkdirSync(otherRoot);
  fs.writeFileSync(
    path.join(otherRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { paths: { "@component-a/*": ["src/*"] } } }),
  );
  fixture.linkPackage("@practice/other", otherRoot);
  fixture.appPackage.devDependencies = { "@practice/other": "workspace:*" };
  fixture.writeAppPackage();
  assert.throws(
    () => new MyAliasPlugin().readWorkspaceAliases(fixture.appRoot),
    /Conflicting workspace alias "@component-a"/,
  );
});

test("TypeScript parser handles comments and inherited paths without baseUrl", (t) => {
  const fixture = createFixture(t);
  fs.mkdirSync(path.join(fixture.sdkRoot, "configs"));
  fs.writeFileSync(
    path.join(fixture.sdkRoot, "configs/base.json"),
    '{ // shared options\n "compilerOptions": { "paths": { "@shared/*": ["../src/*"] } } }',
  );
  fs.writeFileSync(
    path.join(fixture.sdkRoot, "tsconfig.json"),
    '{ "extends": "./configs/base.json" }',
  );
  assert.deepEqual(new MyAliasPlugin().readWorkspaceAliases(fixture.appRoot), {
    "@shared": path.join(fixture.sdkRoot, "src"),
  });
});

test("exact TypeScript aliases use Webpack's exact-match suffix", (t) => {
  const fixture = createFixture(t, { "@entry": ["src/component-a/label.js"] });
  assert.deepEqual(new MyAliasPlugin().readWorkspaceAliases(fixture.appRoot), {
    "@entry$": path.join(fixture.sdkRoot, "src/component-a/label.js"),
  });
});

test("invalid TypeScript compiler options report a config error", (t) => {
  const fixture = createFixture(t);
  fs.writeFileSync(
    path.join(fixture.sdkRoot, "tsconfig.json"),
    '{ "compilerOptions": { "target": "invalid-target" } }',
  );
  assert.throws(
    () => new MyAliasPlugin().readWorkspaceAliases(fixture.appRoot),
    /tsconfig\.json:.*target/,
  );
});

test("fallback targets and unsupported wildcard patterns are rejected", (t) => {
  const fixture = createFixture(t, { "@entry": ["first.js", "second.js"] });
  const plugin = new MyAliasPlugin();
  assert.throws(() => plugin.readWorkspaceAliases(fixture.appRoot), /exactly one target/);
  fs.writeFileSync(
    path.join(fixture.sdkRoot, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { paths: { "@entry/*": ["src/*/entry"] } } }),
  );
  assert.throws(() => plugin.readWorkspaceAliases(fixture.appRoot), /Unsupported paths pattern/);
});
