const path = require("node:path");
const MyAliasPlugin = require("./plugins/my-alias-plugin.cjs");

module.exports = {
  mode: "production",
  target: "node",
  entry: path.resolve(__dirname, "src/index.ts"),
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "app.cjs",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".js"],
    conditionNames: ["source", "..."],
  },
  plugins: [new MyAliasPlugin({ rootDir: __dirname, debug: true })],
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: [
              [
                require.resolve("@babel/preset-env"),
                { targets: { node: "18" } },
              ],
              require.resolve("@babel/preset-typescript"),
            ],
          },
        },
      },
    ],
  },
};
