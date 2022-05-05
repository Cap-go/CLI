const path = require('path');
const webpack = require('webpack');
const nodeExternals = require('webpack-node-externals');
console.log(process.env.NODE_ENV || 'production');
module.exports = {
  mode: process.env.NODE_ENV || 'production',
  target: 'node',
  externals: [nodeExternals()],
  entry: './src/bin/index.ts',
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  devtool: process.env.NODE_ENV === 'development' ? 'eval-source-map' : undefined,
  watch: process.env.NODE_ENV === 'development',
  plugins: [new webpack.BannerPlugin({ banner: '#!/usr/bin/env node', raw: true })],
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
  },
};
