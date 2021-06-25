const path = require('path');
const webpack = require('webpack');
const nodeExternals = require('webpack-node-externals');
const { CheckerPlugin } = require('awesome-typescript-loader');
console.log(process.env.NODE_ENV);
module.exports = {
  mode: process.env.NODE_ENV,
  target: 'node',
  externals: [nodeExternals()],
  entry: './src/bin/index.ts',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'awesome-typescript-loader',
        exclude: /node_modules/,
      },
    ],
  },
  devtool: process.env.NODE_ENV === 'development' ? 'eval-source-map' : undefined,
  watch: process.env.NODE_ENV === 'development',
  plugins: [new CheckerPlugin(), new webpack.BannerPlugin({ banner: '#!/usr/bin/env node', raw: true })],
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
  },
};
