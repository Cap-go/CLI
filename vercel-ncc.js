require('@vercel/ncc')('/src/index.ts', {
  cache:  false,
  externals: ["externalpackage"],
  filterAssetBase: process.cwd(), 
  minify: false, 
  sourceMap: false, 
  assetBuilds: false, 
  sourceMapRegister: true,
  watch: false,
  license: '', 
  target: 'es2015',
  v8cache: false,
  quiet: false, 
  debugLog: false 
}).then(({ code }) => {
  console.log(code);
 
})