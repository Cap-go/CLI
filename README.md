# Capgo CLI
  <a href="https://capgo.app/"><img src='https://raw.githubusercontent.com/Cap-go/capgo/main/assets/capgo_banner.png' alt='Capgo - Instant updates for capacitor'/></a>

<div align="center">
<h2><a href="https://capgo.app/">Check out: Capgo — Instant updates for capacitor</a></h2>
</div>

A CLI to upload and download files from the Capacitor go Cloud.

## Usage

Before use the CLI you should register here : https://capgo.app/

Then go in you account in apikey section and click in the `all` key to copy it.

## Login to Cloud
`npx @capgo/cli login API_KEY`
`API_KEY` your  apikey copied in the previous step

## Add new app to Cloud
`npx @capgo/cli add [appId]`
`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/init)

Optionally you can give:
- icon with `--icon /path/to/my/icon` to have a custom icon in the list
- name with `--name test` to have a custom name in the list


### Send version to Cloud
`npx @capgo/cli upload [appId]`
`[appId]` is your app ID the format is explained [here](https://capacitorjs.com/docs/cli/init)

Optionally you can give:
- icon with `--path /path/to/my/dist/folder` to send your code to the cloud
- name with `--name test` to have a custom name in the list
- channel with `--channel prod` to link this version to channel

### Send version to Cloud channel
`npx @capgo/cli set [appId] [version] [channel]`
`[appId]` your app ID the format is explained [here](https://capacitorjs.com/docs/cli/init)
`[version]` your app version already sended to the cloud
`[channel]` the channel you want to link the version

### Delete package to Cloud
`npx @capgo/cli delete [appId]`
`[appId]` your app ID present in the Cloud

### Delete older packages in a semver range for a major version to Cloud
`npx @capgo/cli cleanup [appId] --bundle=[majorVersion]`
`[appId]` your app ID present in the Cloud
`[majorVersion]` a version you want to remove previous packages for, it will keep the last 5

For example: 
If you have 10 versions, from 10.0.1 to 10.0.11, and you use 
`npx @capgo/cli cleanup [appId] --bundle=10.0.0` 
it will remove 10.0.1 to 10.0.6. 
10.0.7 till 10.0.11 will be kept

This command will show a list of what it will be removing and ask for confirmation

### Configure channel
`npx @capgo/cli set [appId] --channel dev
`
Optionally, you can give:
[appId] your app ID the format is explained here
--bundle your app bundle already sent to the cloud to
--state set the channel state, can be normal or default. To use in your app, one channel need to be "default".
--downgrade allow the channel to send downgrade version to devices.
--no-downgrade disallow the channel to send downgrade version to devices.
--upgrade allow the channel to send upgrade (major) version to devices.
--no-upgrade disallow the channel to send upgrade (major) version to devices.
--ios allow the channel to send version to iOS devices.
--no-ios disallow the channel to send version to iOS devices.
--android allow the channel to send version to android devices.
--no-android disallow the channel to send version to android devices.
--self-assign allow devices to self assign to this channel.
--no-self-assign disallow devices to self assign to this channel.

## Dev contribution

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
