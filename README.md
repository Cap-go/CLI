# Capacitor Go CLI

A CLI to upload and download files from the Capacitor go Cloud.

## Install 

`npm i -g capgo`
## Usage

# Send Dev version to Cloud
`capgo --apikey=******** --path=./dist --version=0.0.4 --name=mimesis`
# Send Producition version to Cloud
`capgo --apikey=******** --path=./dist --version=0.0.4 --name=mimesis --production`

1. Install development dependencies

   ```shell
     rm -rf node_modules
     npm i
   ```

2. Set `"sourceMap": true,` in tsconfig.json

3. Run webpack development server

   ```shell
     npm run dev
   ```

4. Attach debugger to the process started with `npm run dev`

   > VScode:

   - Run `Debug on fixtures` launch configuration
   - Edit configuration to debug on different files

   > Other IDEs:

   - Attach debugger of your choice to the running process, use .vscode/launch.json `Debug on fixtures` configuration as the example

## Production build

1. Set `"sourceMap": false,` in tsconfig.json

   > TODO: add separate build config

2. Run

```shell
    npm install && set NODE_ENV=production&& npx webpack --config webpack.config.js && rm -rf node_modules && npm i --only=prod && npm prune --production && npm shrinkwrap
```

## Publish to NPM

To release a new package version:

1. Bump version in `package.json` manually
2. Run commands from **Production build** section
3. Run `npm publish --dry-run`:

   - ensure that only necessary files are listed in package preview

   - ensure that `npm-shrinkwrap.json` **does not include development dependencies**

4. Run `npm publish` or `npm publish --tag beta`

## Pack executable

**prerequisite**: perform production build

> Pkg will not resolve dynamic module imports, so avoid these at all costs. (Basically, just use plain ordinary static `import Something from 'somewhere'` and no issue should arise)

Build for all supported platforms

```shell
  pkg ./dist/index.js
```

> You can specify targets with `-t` option (refer to `pkg --help` and examples on [pkg's npm](https://www.npmjs.com/package/pkg))
> e.g. use `pkg -t node14-win-x64 ./dist/index.js` to build for Node14, Windows x64

Build for Node14 Windows x64

```shell
   pkg -t node14-win-x64 ./dist/index.js
```
