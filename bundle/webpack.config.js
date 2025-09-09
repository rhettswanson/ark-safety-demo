// webpack.config.js
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index_bundle.[contenthash].js',
    publicPath: './',          // <— make emitted URLs relative (good for /RepoName/ on GH Pages)
    clean: true,
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, './src/index.html'),
      scriptLoading: 'defer',
    }),
    new CopyPlugin({
      patterns: [
        // Copy everything in /static to the DIST ROOT so requests to /js/... /fonts/... work
        { from: path.resolve(__dirname, 'static'), to: '.' },
      ],
    }),
  ],
  devServer: {
    static: [
      path.resolve(__dirname, 'dist'),
      path.resolve(__dirname, 'static'),
    ],
    compress: true,
    port: 5173,
    hot: true,
    historyApiFallback: true,
  },
  performance: { hints: false },
};