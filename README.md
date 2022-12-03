# Capgo CLI
  <a href="https://capgo.app/"><img src='https://raw.githubusercontent.com/Cap-go/capgo/main/assets/capgo_banner.png' alt='Capgo - Instant updates for capacitor'/></a>

<div align="center">
<h2><a href="https://capgo.app/">Check out: Capgo — Instant updates for capacitor</a></h2>
</div>

A CLI to upload and download files from the Capgo Cloud.

## Usage

Before use the CLI, you should register here : https://capgo.app/

Then go to your account in `apikey` section and click in the `all` key to copy it.

## Login to Cloud
`npx @capgo/cli login [apikey]`
`[apikey]` your `apikey` coming from your account.

Optionally, you can give:
- `--local` to save the API key in the local folder.

## Add new app to Cloud
`npx @capgo/cli add [appId]`
`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/init)

Optionally, you can give:
- `--icon [/path/to/my/icon]` to have a custom icon in the list.
- `--name [test]` to have a custom name in the list.
- `--apikey [key]` API key to link to your account.

### Send version to Cloud
`npx @capgo/cli upload [appId]`
`[appId]` is your app ID the format is explained [here](https://capacitorjs.com/docs/cli/init)
Optionally, you can give:
- `--apikey [key]` API key to link to your account.
- `--path [/path/to/my/app]` to upload a specific folder.
- `--channel [test]` to upload to a specific channel.
- `--external [https://mydomain.com/myapp.zip]` to link to an external URL instead of upload to Capgo cloud.
- `--key [/path/to/my/private_key]` the path of your private key.
- `--key-data [privateKey]` the private key data, if you want to use inline.
- `--no-key` to ignore signing key and send clear update.
- `--bundle [1.0.0]` to set the bundle version number of the file to upload.
- `--iv-session-key [key]` to send a custom session key to the cloud.

### Send version to Cloud channel
`npx @capgo/cli set [appId] [version] [channel]`
`[appId]` your app ID the format is explained [here](https://capacitorjs.com/docs/cli/init)
`[version]` your app version already sent to the cloud
`[channel]` the channel you want to link the version

Optionally, you can give:
- `--apikey [key]` API key to link to your account.
### Delete package to Cloud
`npx @capgo/cli delete [appId]`
`[appId]` your app ID present in the Cloud

Optionally, you can give:
- `--apikey [key]` API key to link to your account.
### Delete older packages in a SemVer range for a major version to Cloud
`npx @capgo/cli cleanup [appId] --bundle=[majorVersion] --keep=[numberToKeep]`
`[appId]` your app ID present in the Cloud.
`[majorVersion]` a version you wish to remove previous packages for, it will keep the last one + numberToKeep.
`[numberToKeep]` the number of packages you wish to keep (default 4).

Optionally, you can give:
- `--apikey [key]` API key to link to your account.


For example: 
If you have 10 versions, from 10.0.1 to 10.0.11, and you use 
`npx @capgo/cli cleanup [appId] --bundle=10.0.0` 
it will remove 10.0.1 to 10.0.6. 
10.0.7 until 10.0.11 will be kept

This command will show a list of what it will be removing and ask for confirmation.

### Configure channel
`npx @capgo/cli set [appId] --channel dev`
`[appId]` your app ID the format is explained here.

Optionally, you can give:
`--bundle [1.2.3]` your app bundle already sent to the cloud, to link it to a channel.
`--latest` get the bundle version from `package.json:version`, cannot be used with `--bundle`.
`--state [ normal | default ]` set the channel state, can be `normal` or `default`. One channel need to be `default`.
`--downgrade` allow the channel to send downgrade version to devices.
`--no-downgrade` disallow the channel to send downgrade version to devices.
`--upgrade` allow the channel to send upgrade (major) version to devices.
`--no-upgrade` disallow the channel to send upgrade (major) version to devices.
`--ios` allow the channel to send version to iOS devices.
`--no-ios` disallow the channel to send version to iOS devices.
`--android` allow the channel to send version to android devices.
`--no-android` disallow the channel to send version to android devices.
`--self-assign` allow devices to self assign to this channel.
`--no-self-assign` disallow devices to self assign to this channel.
- `--apikey [key]` API key to link to your account.

## End-to-End encryption (Zero trust)

Capgo support end-to-end encryption, this mean that your code is encrypted before send to the cloud and decrypted on the device.
For that, you need to generate an RSA key pair, you can use the following command to generate it.

The encryption system is a combination of RSA and AES, the RSA key is used to encrypt the AES key, and the AES key is used to encrypt the file.

See below for more information about the encryption system.

![crypto_explained](/crypto_explained.png)

### Create key for your app
`npx @capgo/cli key create`

Optionally, you can give:
`--force` to overwrite the existing key.
This command will create for you a key pair in your app, and will ask you to save the private key in a safe place.
It's recommended to not git commit the private and public key, and to not share it with anyone.

### Save key in your app config
`npx @capgo/cli key save`

Optionally, you can give:
`--key [/path/to/my/private_key]` the path of your private key.
`--key-data [privateKey]` the private key data, if you want to use inline.
This command is useful if you followed the recommendation and didn't commit the key in your app, and in the config.

### Encrypt zip with your key
`npx @capgo/cli encrypt [path/to/zip]`
Optionally, you can give:
`--key [/path/to/my/private_key]` the path of your private key.
`--key-data [privateKey]` the private key data, if you want to use inline.
This command is use when you use external source to store your code or for test purpose.
The command will print your ivSessionKey and the encrypted zip, you can use it with the `--iv-session-key` and `--external` option of the `upload` command, or for decrypting the zip.


### Decrypt zip with your key
`npx @capgo/cli encrypt [path/to/zip] [ivSessionKey]`

Optionally, you can give:
`--key [/path/to/my/private_key]` the path of your private key.
`--key-data [privateKey]` the private key data, if you want to use inline.
This command is mainly used for test purpose, it will decrypt the zip and print the base64 decrypted session key in the console.

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

   > VS Code:

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
