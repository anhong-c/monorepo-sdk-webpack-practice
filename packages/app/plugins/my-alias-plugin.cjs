const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

class MyAliasPlugin {
  constructor(options = {}) {
    this.rootDir = options.rootDir;
    this.debug = options.debug ?? false;
  }

  apply(compiler) {
    compiler.hooks.afterEnvironment.tap("MyAliasPlugin", () => {
      const rootDir = this.rootDir ?? compiler.context;
      const currentAliases = compiler.options.resolve.alias ?? {};

      if (Array.isArray(currentAliases)) {
        throw new TypeError("MyAliasPlugin expects resolve.alias to be an object.");
      }

      const aliases = this.readWorkspaceAliases(rootDir);
      compiler.options.resolve.alias = { ...aliases, ...currentAliases };

      if (this.debug) {
        console.log("[MyAliasPlugin] webpack aliases:", aliases);
      }
    });
  }

  readWorkspaceAliases(rootDir) {
    const packageJsonPath = path.join(rootDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };
    const workspacePackages = Object.entries(dependencies)
      .filter(([, version]) => version.startsWith("workspace:"))
      .map(([packageName]) => packageName);
    const aliases = {};

    if (this.debug) {
      console.log("[MyAliasPlugin] workspace packages:", workspacePackages);
    }

    for (const packageName of workspacePackages) {
      const packageRoot = this.resolveWorkspacePackage(rootDir, packageName);
      const tsconfigPath = path.join(packageRoot, "tsconfig.json");

      if (this.debug) {
        console.log(`[MyAliasPlugin] ${packageName}: ${packageRoot}`);
      }

      if (!fs.existsSync(tsconfigPath)) {
        continue;
      }

      const packageAliases = this.readTsconfigAliases(tsconfigPath, packageRoot);

      for (const [alias, target] of Object.entries(packageAliases)) {
        if (Object.hasOwn(aliases, alias) && aliases[alias] !== target) {
          throw new Error(
            `Conflicting workspace alias "${alias}" in package "${packageName}".`,
          );
        }

        aliases[alias] = target;
      }
    }

    return aliases;
  }

  resolveWorkspacePackage(rootDir, packageName) {
    const linkedPath = path.join(rootDir, "node_modules", ...packageName.split("/"));

    if (!fs.existsSync(linkedPath)) {
      throw new Error(
        `Cannot find workspace package "${packageName}" at "${linkedPath}". Run pnpm install first.`,
      );
    }

    return fs.realpathSync(linkedPath);
  }

  readTsconfigAliases(tsconfigPath, packageRoot) {
    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

    if (configFile.error) {
      throw new Error(
        `${tsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`,
      );
    }

    const parsedConfig = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      packageRoot,
      undefined,
      tsconfigPath,
    );
    const configErrors = parsedConfig.errors.filter((error) => error.code !== 18003);

    if (configErrors.length > 0) {
      throw new Error(
        `${tsconfigPath}: ${configErrors
          .map((error) => ts.flattenDiagnosticMessageText(error.messageText, "\n"))
          .join("\n")}`,
      );
    }

    const paths = parsedConfig.options.paths ?? {};
    const baseUrl =
      parsedConfig.options.baseUrl ?? parsedConfig.options.pathsBasePath ?? packageRoot;
    const aliases = {};

    for (const [alias, targets] of Object.entries(paths)) {
      if (targets.length !== 1) {
        throw new Error(`Alias "${alias}" must have exactly one target in ${tsconfigPath}.`);
      }

      const target = targets[0];
      const isPrefix = alias.endsWith("/*");
      const webpackAlias = isPrefix ? alias.slice(0, -2) : `${alias}$`;
      const webpackTarget = isPrefix && target.endsWith("/*")
        ? target.slice(0, -2)
        : target;

      if (
        alias.replace(/\/\*$/, "").includes("*") ||
        webpackTarget.includes("*") ||
        (isPrefix && !target.endsWith("/*"))
      ) {
        throw new Error(
          `Unsupported paths pattern "${alias}" -> "${target}" in ${tsconfigPath}. Use exact paths or matching trailing /* patterns.`,
        );
      }

      aliases[webpackAlias] = path.resolve(baseUrl, webpackTarget);
    }

    return aliases;
  }
}

module.exports = MyAliasPlugin;
