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
> 💡 All option will be guessed in your config if not provided.

Optionally, you can give:
- `--icon [/path/to/my/icon]` to have a custom icon in the list.
- `--name [test]` to have a custom name in the list.
- `--apikey [key]` API key to link to your account.

Example of capacitor.config.json for appId and AppName, the icon is guess in the resources folder
```json
{
  "appId": "ee.forgr.capacitor_go",
  "appName": "Capgo",
  "webDir": "dist",
}
```
### Send version to Cloud
`npx @capgo/cli upload [appId]`
`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/init)
Optionally, you can give:
- `--apikey [key]` API key to link to your account.
- `--path [/path/to/my/app]` to upload a specific folder.
- `--channel [test]` to upload to a specific channel.
- `--external [https://mydomain.com/myapp.zip]` to link to an external URL instead of upload to Capgo cloud, it should be a zip URL in HTTPS.
- `--key [/path/to/my/private_key]` the path of your private key.
- `--key-data [privateKey]` the private key data, if you want to use inline.
- `--no-key` to ignore signing key and send clear update.
- `--bundle [1.0.0]` to set the bundle version number of the file to upload.
- `--iv-session-key [key]` to send a custom session key to the cloud.

> ⭐️ External option help to unlock 2 cases: corporate with privacy concern, don't send the code to a third part and app bigger than 30 MB. With this setting, Capgo store only the link to the zip and send the link to all app.

> 👀 Capgo cloud never look of what is in the link (for external option), or in the code when stored.

> 🔑 You can add a second layer of security by using encryption, then Capgo will not be able to look or modify anything, it becomes “trustless”.

Example of `package.json` for version
```json
{
 "version": "1.0.2"
}
```
> ⛔ Version should be greater than “0.0.0”.

>💡 Don't forget to update the version number each time you send one, or the device will don't see the update.

### Channel

#### Create
`npx @capgo/cli channel create [channelId] [appId]`
`[channelId]` the name of your new channel.
`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/init).

#### Delete
`npx @capgo/cli channel delete [channelId] [appId]`
`[channelId]` the name of your channel you want to delete.
`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/init).

### Set
`npx @capgo/cli channel set [channelId] [appId]`
`[channelId]` the name of your channel you want to set.
`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/init).


Optionally, you can give:
- `--bundle [1.2.3]` your app bundle already sent to the cloud, to link it to a channel.
- `--latest` get the bundle version from `package.json:version`, cannot be used with `--bundle`.
- `--state [ normal | default ]` set the channel state, can be `normal` or `default`. One channel need to be `default`.
- `--downgrade` allow the channel to send downgrade version to devices.
- `--no-downgrade` disallow the channel to send downgrade version to devices.
- `--upgrade` allow the channel to send upgrade (major) version to devices.
- `--no-upgrade` disallow the channel to send upgrade (major) version to devices.
- `--ios` allow the channel to send version to iOS devices.
- `--no-ios` disallow the channel to send version to iOS devices.
- `--android` allow the channel to send version to android devices.
- `--no-android` disallow the channel to send version to android devices.
- `--self-assign` allow devices to self assign to this channel.
- `--no-self-assign` disallow devices to self assign to this channel.
- `--apikey [key]` API key to link to your account.

### List versions
`npx @capgo/cli list [appId] `
`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/init).

### Doctor installed package
`npx @capgo/cli doctor`
Learn info about the Capgo package installed on your project and see if update are available.

### Delete package to Cloud
`npx @capgo/cli delete [appId]`
`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/init).

Optionally, you can give:
- `--apikey [key]` API key to link to your account.
- `--bundle [bundleVersion]` with the version number will only delete this version
### Cleanup older packages in a SemVer range for a major version to Cloud
`npx @capgo/cli cleanup [appId] --bundle=[majorVersion] --keep=[numberToKeep]`
`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/init).

Optionally, you can give:
- `--apikey [key]` API key to link to your account.
- `--bundle [majorVersion]` a version you wish to remove previous packages for, it will keep the last one + `numberToKeep`.
- `--keep [numberToKeep]` the number of packages you wish to keep (default 4).

For example: 
If you have 10 versions from 10.0.1 to 10.0.11, and you use 
`npx @capgo/cli cleanup [appId] --bundle=10.0.0` 
it will remove 10.0.1 to 10.0.6. 
10.0.7 until 10.0.11 will be kept.

If you have 20 versions in total, and you don't provide a bundle number like this:
`npx @capgo/cli cleanup [appId] --keep=2`
It will remove 18 versions, and keep the last 2.

> This command will ask for confirmation, it shows a table of what it will be keeping and removing.

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

> After your local test remove the key from config file and add it on CI step with `key save`

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

2. Set `"sourceMap": true,` in `tsconfig.json`

3. Run webpack development server

   ```shell
     npm run dev
   ```

4. Attach debugger to the process started with `npm run dev`

   > VS Code:

   - Run `Debug on fixtures` launch configuration
   - Edit configuration to debug on different files

   > Other IDEs:

   - Attach debugger of your choice to the running process, use `.vscode/launch.json` `Debug on fixtures` configuration as the example

## Production build

1. Set `"sourceMap": false,` in `tsconfig.json`

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
