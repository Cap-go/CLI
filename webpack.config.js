const path = require("path");
const webpack = require("webpack");
const nodeExternals = require("webpack-node-externals");
console.log(process.env.NODE_ENV || "production");
module.exports = {
  // mode: "developement",
  target: "node",
  externals: [nodeExternals()],
  entry: "./src/index.ts",
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: "ts-loader",
        exclude: /node_modules/,
      },
    ],
  },
  devtool: "eval-source-map",
  watch: true,
  plugins: [
    new webpack.BannerPlugin({ banner: "#!/usr/bin/env node", raw: true }),
    new webpack.EnvironmentPlugin({
      SUPA_DB: "production",
    }),
  ],
  resolve: {
    extensions: [".ts", ".js"],
  },
  output: {
    filename: "index.js",
    path: path.resolve(__dirname, "dist"),
  },
};
