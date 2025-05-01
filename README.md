# Capgo CLI
  <a href="https://capgo.app/"><img src='https://raw.githubusercontent.com/Cap-go/capgo/main/assets/capgo_banner.png' alt='Capgo - Instant updates for capacitor'/></a>

<div align="center">
<h2><a href="https://capgo.app/">Check out: Capgo — Instant updates for capacitor</a></h2>
</div>

A CLI to upload and download files from the Capgo Cloud.

You can find the most up to date version of this doc in our web doc:
https://capgo.app/docs/cli/overview/

## Usage

Before use the CLI, you should register here : https://capgo.app/

Then go to your account in `apikey` section and click in the `all` key to copy it.

Follow the documentation here : "https://capacitorjs.com/docs/getting-started/

<!-- AUTO-GENERATED-DOCS-START -->
## 📑 Capgo CLI Commands

## 📋 Table of Contents

- [Init](#init)
- [Doctor](#doctor)
- [Login](#login)
- [Bundle](#bundle)
  - [Upload](#bundle-upload)
  - [Compatibility](#bundle-compatibility)
  - [Delete](#bundle-delete)
  - [List](#bundle-list)
  - [Cleanup](#bundle-cleanup)
  - [Encrypt](#bundle-encrypt)
  - [Decrypt](#bundle-decrypt)
  - [Zip](#bundle-zip)
- [App](#app)
  - [Add](#app-add)
  - [Delete](#app-delete)
  - [List](#app-list)
  - [Debug](#app-debug)
  - [Setting](#app-setting)
  - [Set](#app-set)
- [Channel](#channel)
  - [Add](#channel-add)
  - [Delete](#channel-delete)
  - [List](#channel-list)
  - [CurrentBundle](#channel-currentBundle)
  - [Set](#channel-set)
- [Key](#key)
  - [Save](#key-save)
  - [Create](#key-create)
  - [Delete_old](#key-delete_old)
- [Account](#account)
  - [Id](#account-id)

### <a id="init"></a> 🚀 **Init**

**Alias:** `i`

```bash
npx @capgo/cli@latest init
```

🚀 Initialize a new app in Capgo Cloud with step-by-step guidance.

This includes adding code for updates, building, uploading your app, and verifying update functionality.

**Example:**

```bash
npx @capgo/cli@latest init YOUR_API_KEY com.example.app
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-n,** | <code>string</code> | App name for display in Capgo Cloud |
| **-i,** | <code>string</code> | App icon path for display in Capgo Cloud |
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |

### <a id="doctor"></a> 👨‍⚕️ **Doctor**

```bash
npx @capgo/cli@latest doctor
```

👨‍⚕️ Check if your Capgo app installation is up-to-date and gather information useful for bug reports.

This command helps diagnose issues with your setup.

**Example:**

```bash
npx @capgo/cli@latest doctor
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **--package-json** | <code>string</code> | A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json) |

### <a id="login"></a> 🔑 **Login**

**Alias:** `l`

```bash
npx @capgo/cli@latest login
```

🔑 Save your Capgo API key to your machine or local folder for easier access to Capgo Cloud services.

Use --apikey=******** in any command to override it.

**Example:**

```bash
npx @capgo/cli@latest login YOUR_API_KEY
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **--local** | <code>boolean</code> | Only save in local folder, git ignored for security. |

### <a id="bundle"></a> 📦 **Bundle**

```bash
npx @capgo/cli@latest bundle
```

📦 Manage app bundles for deployment in Capgo Cloud, including upload, compatibility checks, and encryption.

#### BUNDLE Subcommands:

#### <a id="bundle-upload"></a> ⬆️ **Upload**

**Alias:** `u`

```bash
npx @capgo/cli@latest bundle upload
```

⬆️ Upload a new app bundle to Capgo Cloud for distribution, optionally linking to a channel or external URL.

External option supports privacy concerns or large apps (>200MB) by storing only the link.

Capgo never inspects external content. Encryption adds a trustless security layer.

Version must be > 0.0.0 and unique.

> ℹ️ External option helps with corporate privacy concerns and apps larger than 200MB by storing only the link.

> ℹ️ Capgo Cloud never looks at the content in the link for external options or in the code when stored.

> ℹ️ You can add a second layer of security with encryption, making Capgo trustless.

> ℹ️ Version should be greater than "0.0.0" and cannot be overridden or reused after deletion for security reasons.

**Example:**

```bash
npx @capgo/cli@latest bundle upload com.example.app --path ./dist --channel production
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |
| **-p,** | <code>string</code> | Path of the folder to upload, if not provided it will use the webDir set in capacitor.config |
| **-c,** | <code>string</code> | Channel to link to |
| **-e,** | <code>string</code> | Link to external URL instead of upload to Capgo Cloud |
| **--iv-session-key** | <code>string</code> | Set the IV and session key for bundle URL external |
| **--s3-region** | <code>string</code> | Region for your S3 bucket |
| **--s3-apikey** | <code>string</code> | API key for your S3 endpoint |
| **--s3-apisecret** | <code>string</code> | API secret for your S3 endpoint |
| **--s3-endoint** | <code>string</code> | URL of S3 endpoint |
| **--s3-bucket-name** | <code>string</code> | Name for your AWS S3 bucket |
| **--s3-port** | <code>string</code> | Port for your S3 endpoint |
| **--no-s3-ssl** | <code>boolean</code> | Disable SSL for S3 upload |
| **--key-v2** | <code>string</code> | Custom path for private signing key (v2 system) |
| **--key-data-v2** | <code>string</code> | Private signing key (v2 system) |
| **--bundle-url** | <code>boolean</code> | Prints bundle URL into stdout |
| **--no-key** | <code>boolean</code> | Ignore signing key and send clear update |
| **--no-code-check** | <code>boolean</code> | Ignore checking if notifyAppReady() is called in source code and index present in root folder |
| **--display-iv-session** | <code>boolean</code> | Show in the console the IV and session key used to encrypt the update |
| **-b,** | <code>string</code> | Bundle version number of the bundle to upload |
| **--link** | <code>string</code> | Link to external resource (e.g. GitHub release) |
| **--comment** | <code>string</code> | Comment about this version, could be a release note, a commit hash, a commit message, etc. |
| **--min-update-version** | <code>string</code> | Minimal version required to update to this version. Used only if the disable auto update is set to metadata in channel |
| **--auto-min-update-version** | <code>boolean</code> | Set the min update version based on native packages |
| **--ignore-metadata-check** | <code>boolean</code> | Ignores the metadata (node_modules) check when uploading |
| **--ignore-checksum-check** | <code>boolean</code> | Ignores the checksum check when uploading |
| **--timeout** | <code>string</code> | Timeout for the upload process in seconds |
| **--multipart** | <code>boolean</code> | Uses multipart protocol to upload data to S3, Deprecated, use tus instead |
| **--zip** | <code>boolean</code> | Upload the bundle using zip to Capgo cloud (legacy) |
| **--tus** | <code>boolean</code> | Upload the bundle using TUS to Capgo cloud |
| **--tus-chunk-size** | <code>string</code> | Chunk size for the TUS upload |
| **--partial** | <code>boolean</code> | Upload partial files to Capgo cloud |
| **--partial-only** | <code>boolean</code> | Upload only partial files to Capgo cloud, skip the zipped file, useful for big bundle |
| **--encrypted-checksum** | <code>string</code> | An encrypted checksum (signature). Used only when uploading an external bundle. |
| **--auto-set-bundle** | <code>boolean</code> | Set the bundle in capacitor.config.json |
| **--dry-upload** | <code>boolean</code> | Dry upload the bundle process, mean it will not upload the files but add the row in database (Used by Capgo for internal testing) |
| **--package-json** | <code>string</code> | A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json) |
| **--node-modules** | <code>string</code> | A list of paths to node_modules. Useful for monorepos (comma separated ex: ../../node_modules,./node_modules) |
| **--encrypt-partial** | <code>boolean</code> | Encrypt the partial update files (automatically applied for updater > 6.14.4) |
| **--delete-linked-bundle-on-upload** | <code>boolean</code> | Locates the currently linked bundle in the channel you are trying to upload to, and deletes it |
| **--no-brotli-patterns** | <code>string</code> | Glob patterns for files to exclude from brotli compression (comma-separated) |
| **--disable-brotli** | <code>boolean</code> | Completely disable brotli compression even if updater version supports it |
| **--supa-host** | <code>string</code> | Supabase host URL, for self-hosted Capgo or testing |
| **--supa-anon** | <code>string</code> | Supabase anon token, for self-hosted Capgo or testing |

#### <a id="bundle-compatibility"></a> 🧪 **Compatibility**

```bash
npx @capgo/cli@latest bundle compatibility
```

🧪 Check compatibility of a bundle with a specific channel in Capgo Cloud to ensure updates are safe.

**Example:**

```bash
npx @capgo/cli@latest bundle compatibility com.example.app --channel production
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |
| **-c,** | <code>string</code> | Channel to check the compatibility with |
| **--text** | <code>boolean</code> | Output text instead of emojis |
| **--package-json** | <code>string</code> | A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json) |
| **--node-modules** | <code>string</code> | A list of paths to node_modules. Useful for monorepos (comma separated ex: ../../node_modules,./node_modules) |

#### <a id="bundle-delete"></a> 🗑️ **Delete**

**Alias:** `d`

```bash
npx @capgo/cli@latest bundle delete
```

🗑️ Delete a specific bundle from Capgo Cloud, optionally targeting a single version.

**Example:**

```bash
npx @capgo/cli@latest bundle delete BUNDLE_ID com.example.app
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |

#### <a id="bundle-list"></a> 📋 **List**

**Alias:** `l`

```bash
npx @capgo/cli@latest bundle list
```

📋 List all bundles uploaded for an app in Capgo Cloud.

**Example:**

```bash
npx @capgo/cli@latest bundle list com.example.app
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |

#### <a id="bundle-cleanup"></a> 🧹 **Cleanup**

**Alias:** `c`

```bash
npx @capgo/cli@latest bundle cleanup
```

🧹 Cleanup old bundles in Capgo Cloud, keeping a specified number of recent versions or those linked to channels.

Ignores bundles in use.

**Example:**

```bash
npx @capgo/cli@latest bundle cleanup com.example.app --bundle=1.0 --keep=3
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-b,** | <code>string</code> | Bundle version number of the app to delete |
| **-a,** | <code>string</code> | API key to link to your account |
| **-k,** | <code>string</code> | Number of versions to keep |
| **-f,** | <code>string</code> | Force removal |
| **--ignore-channel** | <code>boolean</code> | Delete all versions even if linked to a channel, this will delete channel as well |

#### <a id="bundle-encrypt"></a> 🔒 **Encrypt**

```bash
npx @capgo/cli@latest bundle encrypt
```

🔒 Encrypt a zip bundle using the new encryption method for secure external storage or testing.

Used with external sources or for testing, prints ivSessionKey for upload or decryption.

**Example:**

```bash
npx @capgo/cli@latest bundle encrypt ./myapp.zip CHECKSUM
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **--key** | <code>string</code> | Custom path for private signing key |
| **--key-data** | <code>string</code> | Private signing key |
| **-j,** | <code>string</code> | Output in JSON |

#### <a id="bundle-decrypt"></a> 🔓 **Decrypt**

```bash
npx @capgo/cli@latest bundle decrypt
```

🔓 Decrypt a zip bundle using the new encryption method, mainly for testing purposes.

Prints the base64 decrypted session key for verification.

**Example:**

```bash
npx @capgo/cli@latest bundle decrypt ./myapp_encrypted.zip CHECKSUM
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **--key** | <code>string</code> | Custom path for private signing key |
| **--key-data** | <code>string</code> | Private signing key |
| **--checksum** | <code>string</code> | Checksum of the bundle, to verify the integrity of the bundle |

#### <a id="bundle-zip"></a> 🔹 **Zip**

```bash
npx @capgo/cli@latest bundle zip
```

🗜️ Create a zip file of your app bundle for upload or local storage.

Useful for preparing bundles before encryption or upload.

**Example:**

```bash
npx @capgo/cli@latest bundle zip com.example.app --path ./dist
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-p,** | <code>string</code> | Path of the folder to upload, if not provided it will use the webDir set in capacitor.config |
| **-b,** | <code>string</code> | Bundle version number to name the zip file |
| **-n,** | <code>string</code> | Name of the zip file |
| **-j,** | <code>string</code> | Output in JSON |
| **--no-code-check** | <code>boolean</code> | Ignore checking if notifyAppReady() is called in source code and index present in root folder |
| **--key-v2** | <code>boolean</code> | Use encryption v2 |
| **--package-json** | <code>string</code> | A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json) |

### <a id="app"></a> 📱 **App**

```bash
npx @capgo/cli@latest app
```

📱 Manage your Capgo app settings and configurations in Capgo Cloud.

#### APP Subcommands:

#### <a id="app-add"></a> ➕ **Add**

**Alias:** `a`

```bash
npx @capgo/cli@latest app add
```

➕ Add a new app to Capgo Cloud with a unique app ID in the format com.test.app.

All options can be guessed from config if not provided.

**Example:**

```bash
npx @capgo/cli@latest app add com.example.app --name "My App" --icon ./icon.png
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-n,** | <code>string</code> | App name for display in Capgo Cloud |
| **-i,** | <code>string</code> | App icon path for display in Capgo Cloud |
| **-a,** | <code>string</code> | API key to link to your account |

#### <a id="app-delete"></a> 🗑️ **Delete**

```bash
npx @capgo/cli@latest app delete
```

🗑️ Delete an app from Capgo Cloud, optionally specifying a version to delete only that bundle.

**Example:**

```bash
npx @capgo/cli@latest app delete com.example.app
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |

#### <a id="app-list"></a> 📋 **List**

**Alias:** `l`

```bash
npx @capgo/cli@latest app list
```

📋 List all apps registered under your account in Capgo Cloud.

**Example:**

```bash
npx @capgo/cli@latest app list
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |

#### <a id="app-debug"></a> 🐞 **Debug**

```bash
npx @capgo/cli@latest app debug
```

🐞 Listen for live update events in Capgo Cloud to debug your app.

Optionally target a specific device for detailed diagnostics.

**Example:**

```bash
npx @capgo/cli@latest app debug com.example.app --device DEVICE_ID
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |
| **-d,** | <code>string</code> | The specific device ID to debug |

#### <a id="app-setting"></a> ⚙️ **Setting**

```bash
npx @capgo/cli@latest app setting
```

⚙️ Modify Capacitor configuration programmatically by specifying the path to the setting.

(e.g., plugins.CapacitorUpdater.defaultChannel). You MUST provide either --string or --bool.

**Example:**

```bash
npx @capgo/cli@latest app setting plugins.CapacitorUpdater.defaultChannel --string "Production"
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **--bool** | <code>string</code> | A value for the setting to modify as a boolean, ex: --bool true |
| **--string** | <code>string</code> | A value for the setting to modify as a string, ex: --string "Production" |

#### <a id="app-set"></a> ⚙️ **Set**

**Alias:** `s`

```bash
npx @capgo/cli@latest app set
```

⚙️ Update settings for an existing app in Capgo Cloud, such as name, icon, or retention period for bundles.

Retention of 0 means infinite storage.

**Example:**

```bash
npx @capgo/cli@latest app set com.example.app --name "Updated App" --retention 30
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-n,** | <code>string</code> | App name for display in Capgo Cloud |
| **-i,** | <code>string</code> | App icon path for display in Capgo Cloud |
| **-a,** | <code>string</code> | API key to link to your account |
| **-r,** | <code>string</code> | Retention period of app bundle in days, 0 by default = infinite |

### <a id="channel"></a> 📢 **Channel**

```bash
npx @capgo/cli@latest channel
```

📢 Manage distribution channels for app updates in Capgo Cloud, controlling how updates are delivered to devices.

#### CHANNEL Subcommands:

#### <a id="channel-add"></a> ➕ **Add**

**Alias:** `a`

```bash
npx @capgo/cli@latest channel add
```

➕ Create a new channel for app distribution in Capgo Cloud to manage update delivery.

**Example:**

```bash
npx @capgo/cli@latest channel add production com.example.app --default
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-d,** | <code>string</code> | Set the channel as default |
| **-a,** | <code>string</code> | API key to link to your account |

#### <a id="channel-delete"></a> 🗑️ **Delete**

**Alias:** `d`

```bash
npx @capgo/cli@latest channel delete
```

🗑️ Delete a channel from Capgo Cloud, optionally removing associated bundles to free up resources.

**Example:**

```bash
npx @capgo/cli@latest channel delete production com.example.app
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |
| **--delete-bundle** | <code>boolean</code> | Delete the bundle associated with the channel |

#### <a id="channel-list"></a> 📋 **List**

**Alias:** `l`

```bash
npx @capgo/cli@latest channel list
```

📋 List all channels configured for an app in Capgo Cloud to review distribution settings.

**Example:**

```bash
npx @capgo/cli@latest channel list com.example.app
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |

#### <a id="channel-currentBundle"></a> 📦 **CurrentBundle**

```bash
npx @capgo/cli@latest channel currentBundle
```

📦 Get the current bundle linked to a specific channel in Capgo Cloud for update tracking.

**Example:**

```bash
npx @capgo/cli@latest channel currentBundle production com.example.app
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-c,** | <code>string</code> | Channel to get the current bundle from |
| **-a,** | <code>string</code> | API key to link to your account |
| **--quiet** | <code>boolean</code> | Only print the bundle version |

#### <a id="channel-set"></a> ⚙️ **Set**

**Alias:** `s`

```bash
npx @capgo/cli@latest channel set
```

⚙️ Configure settings for a channel, such as linking a bundle, setting update strategies (major, minor, metadata, patch, none), or device targeting (iOS, Android, dev, emulator).

One channel must be default.

**Example:**

```bash
npx @capgo/cli@latest channel set production com.example.app --bundle 1.0.0 --state default
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |
| **-b,** | <code>string</code> | Bundle version number of the file to set |
| **-s,** | <code>string</code> | Set the state of the channel, default or normal |
| **--latest** | <code>boolean</code> | Get the latest version key in the package.json to set it to the channel |
| **--downgrade** | <code>boolean</code> | Allow to downgrade to version under native one |
| **--no-downgrade** | <code>boolean</code> | Disable downgrade to version under native one |
| **--upgrade** | <code>boolean</code> | Allow to upgrade to version above native one |
| **--no-upgrade** | <code>boolean</code> | Disable upgrade to version above native one |
| **--ios** | <code>boolean</code> | Allow sending update to iOS devices |
| **--no-ios** | <code>boolean</code> | Disable sending update to iOS devices |
| **--android** | <code>boolean</code> | Allow sending update to Android devices |
| **--no-android** | <code>boolean</code> | Disable sending update to Android devices |
| **--self-assign** | <code>boolean</code> | Allow device to self-assign to this channel |
| **--no-self-assign** | <code>boolean</code> | Disable devices to self-assign to this channel |
| **--disable-auto-update** | <code>string</code> | Disable auto update strategy for this channel. The possible options are: major, minor, metadata, patch, none |
| **--dev** | <code>boolean</code> | Allow sending update to development devices |
| **--no-dev** | <code>boolean</code> | Disable sending update to development devices |
| **--emulator** | <code>boolean</code> | Allow sending update to emulator devices |
| **--no-emulator** | <code>boolean</code> | Disable sending update to emulator devices |
| **--package-json** | <code>string</code> | A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json) |

### <a id="key"></a> 🔐 **Key**

```bash
npx @capgo/cli@latest key
```

🔐 Manage encryption keys for secure bundle distribution in Capgo Cloud, supporting end-to-end encryption with RSA and AES combination.

#### KEY Subcommands:

#### <a id="key-save"></a> 🔹 **Save**

```bash
npx @capgo/cli@latest key save
```

💾 Save a base64 encryption key in the Capacitor config, useful for CI environments.

Recommended not to commit the key for security.

**Example:**

```bash
npx @capgo/cli@latest key save --key ./path/to/key
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-f,** | <code>string</code> | Force generate a new one |
| **--key** | <code>string</code> | Key path to save in Capacitor config |
| **--key-data** | <code>string</code> | Key data to save in Capacitor config |

#### <a id="key-create"></a> 🔨 **Create**

```bash
npx @capgo/cli@latest key create
```

🔨 Create a new encryption key pair for end-to-end encryption in Capgo Cloud.

Do not commit or share the private key; save it securely.

**Example:**

```bash
npx @capgo/cli@latest key create
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-f,** | <code>string</code> | Force generate a new one |

#### <a id="key-delete_old"></a> 🗑️ **Delete_old**

```bash
npx @capgo/cli@latest key delete_old
```

🧹 Delete the old encryption key from the Capacitor config to ensure only the current key is used.

**Example:**

```bash
npx @capgo/cli@latest key delete_old
```

### <a id="account"></a> 👤 **Account**

```bash
npx @capgo/cli@latest account
```

👤 Manage your Capgo account details and retrieve information for support or collaboration.

#### ACCOUNT Subcommands:

#### <a id="account-id"></a> 🔹 **Id**

```bash
npx @capgo/cli@latest account id
```

🪪 Retrieve your account ID, safe to share for collaboration or support purposes in Discord or other platforms.

**Example:**

```bash
npx @capgo/cli@latest account id
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-a,** | <code>string</code> | API key to link to your account |

<!-- AUTO-GENERATED-DOCS-END -->

### **Init**

`npx @capgo/cli@latest init [apikey]`

This method is here to onboard you step by step.

It will add your app to Capgo. It will add the code to your app to validate the update. Likewise, it will build your app. Furthermore, it will upload your app to Capgo. And it will help you to check if the update works.

### **Login**

`npx @capgo/cli login [apikey]`

This method is here to remember the `apikey` for you.

:::note
use `--apikey=********` in any command to override it
:::

**Optionaly you can give:**

`--local` This will store your **apikey** in the local repo and git ignore it.

## **Doctor**

`npx @capgo/cli doctor`

Command to check if you are up-to-date with Capgo packages.

This command will also be useful for bug report.

## App

### **Add**

`npx @capgo/cli app add [appId]`

`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

> 💡 All option will be guessed in your config if not provided.

Optionally, you can give:

* `--icon [/path/to/my/icon]` to have a custom icon display in Capgo web app.
* `--name [test]` to have a custom name in the list.
* `--apikey [key]` API key to link to your account.
* `--retention [retention]` retention period of app bundle in days, 0 by default = infinite.

Example of `capacitor.config.json` for appId and AppName, the icon is guess in the resources folder

```json
{
  "appId": "ee.forgr.capacitor_go",
  "appName": "Capgo",
  "webDir": "dist"
}
```

### **Set**

`npx @capgo/cli app set [appId]`

`[appId]` is your app ID, the format is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--icon [/path/to/my/icon]` to have a custom icon display in Capgo web app.
* `--name [test]` to have a custom name in the list.
* `--retention [retention]` retention period of app bundle in days, 0 by default = infinite.
* `--apikey [key]` API key to link to your account.

### **List**

`npx @capgo/cli app list [appId]`

`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--apikey [key]` API key to link to your account.

### **Delete**

`npx @capgo/cli app delete [appId]`

`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--apikey [key]` API key to link to your account.
* `--bundle` with the version number will only delete this version.

### Debug

`npx @capgo/cli app debug [appId]`

`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--apikey [key]` API key to link to your account.
* `--device` with the specific device you want to debug

### Setting

`npx @capgo/cli app setting [path]`

Edit the Capacitor config.

`[path]` - path of the setting that you would like to change. For example, to change the `appId`, provide `appId`.
If you wish to disable auto update in the `capacitor-updater` provide `plugins.CapacitorUpdater.autoUpdate`

You MUST provide either `--string` or `--bool`!

Options:
 - `--string <string>` - sets the setting to a string
 - `--bool <true | false>` - sets the setting to a boolean

## Bundle

### Upload

`npx @capgo/cli bundle upload [appId]`

`[appId]` is your app ID, the format is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Options:

* `--apikey <apikey>` API key to link to your account.
* `--path <path>` Path of the folder to upload.
* `--channel <channel>` Channel to link to.
* `--external <url>` Link to external URL instead of uploading to Capgo Cloud.
* `--iv-session-key <key>` Set the IV and session key for bundle URL external.
* `--s3-endpoint <s3Endpoint>` URL of S3 endpoint. Do not work with Partial upload, or external option.
* `--s3-region <region>` Region for your S3 bucket.
* `--s3-apikey <apikey>` API key for your S3 endpoint.
* `--s3-apisecret <apisecret>` API secret for your S3 endpoint.
* `--s3-bucket-name <bucketName>` Name for your AWS S3 bucket.
* `--s3-port <port>` Port for your S3 endpoint.
* `--no-s3-ssl` Disable SSL for S3 upload.
* `--key <key>` Custom path for public signing key (v1 system).
* `--key-data <keyData>` Public signing key (v1 system).
* `--key-v2 <key>` Custom path for private signing key (v2 system).
* `--key-data-v2 <keyData>` Private signing key (v2 system).
* `--bundle-url` Prints bundle URL into stdout.
* `--no-key` Ignore signing key and send clear update.
* `--no-code-check` Ignore checking if notifyAppReady() is called in source code and index present in root folder.
* `--display-iv-session` Show in the console the IV and session key used to encrypt the update.
* `--bundle <bundle>` Bundle version number of the bundle to upload.
* `--min-update-version <minUpdateVersion>` Minimal version required to update to this version. Used only if the disable auto update is set to metadata in channel.
* `--auto-min-update-version` Set the min update version based on native packages.
* `--ignore-metadata-check` Ignores the metadata (node_modules) check when uploading.
* `--ignore-checksum-check` Ignores the checksum check when uploading.
* `--timeout <timeout>` Timeout for the upload process in seconds.
* `--partial` Does not upload partial files to Capgo cloud.
* `--tus` Upload the bundle using tus protocol.
* `--multipart` Uses multipart protocol to upload data to S3, Deprecated, use TUS instead.
* `--encrypted-checksum <encryptedChecksum>` An encrypted checksum (signature). Used only when uploading an external bundle.
* `--package-json <packageJson>` A path to package.json. Usefull for monorepos.
* `--auto-set-bundle` Set the bundle in capacitor.config.json.
* `--node-modules <nodeModules>` A list of path to node_modules. Usefull for monorepos (comma separated ex: ../../node_modules,./node_modules).

> ⭐️ External option helps to unlock 2 cases: corporate with privacy concern, don't send the code to a third part and app bigger than 200 MB. With this setting, Capgo store only the link to the zip and sends the link to all apps.

> 👀 Capgo cloud never looks at what is in the link (for external option), or in the code when stored.

> 🔑 You can add a second layer of security by using encryption, then Capgo will not be able to look or modify anything, it becomes “trustless”.

Example of `package.json` for version

```json
{
  "version": "1.0.2"
}
```

> ⛔ Version should be greater than “0.0.0”.

> 💡 Don't forget to update the version number each time you send one, version number cannot be overrode, or reused after deletion for security reason.

### **List**

`npx @capgo/cli bundle list [appId]`

`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--apikey [key]` API key to link to your account.

### **Delete**

`npx @capgo/cli bundle delete [bundleId] [appId]`

`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--apikey [key]` API key to link to your account.
* `--bundle` with the version number will only delete this version.

### Cleanup

in a SemVer range for a major version to Cloud

`npx @capgo/cli bundle cleanup [appId] --bundle=[majorVersion] --keep=[numberToKeep]`

`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--apikey [key]` API key to link to your account.
* `--bundle [majorVersion]` a version you wish to remove previous packages for, it will keep the last one + `numberToKeep`.
* `--keep [numberToKeep]` the number of packages you wish to keep (default 4).

For example: If you have 10 versions from 10.0.1 to 10.0.11, and you use `npx @capgo/cli cleanup [appId] --bundle=10.0.0` it will remove 10.0.1 to 10.0.6. 10.0.7 until 10.0.11 will be kept.

If you have 20 versions in total, and you don't provide a bundle number like this: `npx @capgo/cli cleanup [appId] --keep=2` It will remove 18 versions, and keep the last 2.

> This command will ask for confirmation, it shows a table of what it will be keeping and removing.

:::note
This command will ignore bundles which are currently in use in any channel.
:::

### **Encrypt**

> **Warning**: This command is deprecated and will be removed in the next major release. Please use the new encryption system.
`npx @capgo/cli bundle encrypt [path/to/zip]`

This command is used when you use external source to store your code or for test purpose.

Optionally, you can give:

`--key [/path/to/my/private_key]` the path of your private key.
`--key-data [privateKey]` the private key data, if you want to use inline.
The command will print your `ivSessionKey`y and generate an encrypted zip, to use it with the upload command or decryt command.

### **Encrypt V2**

`npx @capgo/cli bundle encryptV2 [path/to/zip] [checksum]`

This command is used when you use external source to store your code or for test purpose.
The checksum is the sha256 of the bundle (generated by --key-v2), it is used to verify the integrity of the file after decryption.
It will be enncrypted with the private key and sent along with the bundle.
In encryption v2 the checksum is upgraded to become a "signature" of the bundle.

Optionally, you can give:

`--key [/path/to/my/private_key]` the path of your private key.
`--key-data [privateKey]` the private key data, if you want to use inline.
`--json` to output info as json.
The command will print your `ivSessionKey`y and generate an encrypted zip, to use it with the upload command or decryt command.

### **Decrypt**

`npx @capgo/cli bundle decrypt [path/to/zip] [ivSessionKey]`

Optionally, you can give:

`--key [/path/to/my/private_key]` the path of your private key.

`--key-data [privateKey]` the private key data, if you want to use inline. This command is mainly used for test purpose, it will decrypt the zip and print the base64 decrypted session key in the console.

### **Decrypt V2**

`npx @capgo/cli bundle decryptV2 [path/to/zip]  [ivSessionKey]`

Optionally, you can give:

`--key [/path/to/my/private_key]` the path of your private key.
`--key-data [privateKey]` the private key data, if you want to use inline. This command is mainly used for test purpose, it will decrypt the zip and print the base64 decrypted session key in the console.
`--checksum [checksum]` the checksum of the file, it will verify the checksum after decryption.

### **Zip**

`npx @capgo/cli bundle zip [appId]`

`[appId]` is your app ID, the format is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--path [/path/to/my/bundle]` to upload a specific folder.
* `--bundle [1.0.0]` to set the bundle version number of the filename.
* `--name [myapp]` to override the filename.
* `--json` to output info as json.
* `--no-code-check` to ignore the code check and send the bundle anyway.
* `--key-v2` to use the new encryption system. This is required as new encryption system use better checksums to verify the integrity of the file.

### **Compatibility**

`npx @capgo/cli bundle compatibility [appId] -c [channelId]`

`[appId]` is your app ID, the format is explained [here](https://capacitorjs.com/docs/cli/commands/init/).
`[channelId]` the name of your new channel.

Optionally, you can give:

* `--apikey [key]` API key to link to your account.
* `--text` use text instead of emojis in the table
* `--channel [channel]` the channel to check the compatibility with.
* `--package-json <packageJson>` A path to package.json. Usefull for monorepos
* `--node-modules <nodeModules>` A list of path to node_modules. Usefull for monorepos (comma separated ex: ../../node_modules,./node_modules)

## Channel

### **Add**

`npx @capgo/cli channel add [channelId] [appId]`

`[channelId]` the name of your new channel. `[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

### **Delete**

`npx @capgo/cli channel delete [channelId] [appId]`

`[channelId]` the name of your channel you want to delete. `[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--delete-bundle` Deletes the bundle associated with the channel.

### **List**

`npx @capgo/cli channel list [appId]`

`[appId]` your app ID the format `com.test.app` is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--apikey [key]` API key to link to your account.

### **Set**

`npx @capgo/cli channel set [channelId] [appId]`

`[appId]` is your app ID, the format is explained [here](https://capacitorjs.com/docs/cli/commands/init/).

Optionally, you can give:

* `--bundle [1.2.3]` your app bundle already sent to the cloud, to link it to a channel.
* `--latest` get the bundle version from `package.json:version`, cannot be used with `--bundle`.
* `--state [ normal | default ]` set the channel state, can be `normal` or `default`. One channel needs to be `default`.
* `--downgrade` allows the channel to send downgrade version to devices.
* `--no-downgrade` disallows the channel to send downgrade version to devices.
* `--upgrade` allows the channel to send upgrade (major) version to devices.
* `--no-upgrade` disallow the channel to send upgrade (major) version to devices.
* `--ios` allows the channel to send version to iOS devices.
* `--no-ios` disallows the channel to send version to iOS devices.
* `--android` allows the channel to send version to android devices.
* `--no-android` disallows the channel to send version to android devices.
* `--self-assign` allows devices to self assign to this channel.
* `--no-self-assign` disallows devices to self assign to this channel.
* `--disable-auto-update STRATEGY`  Disable auto update strategy for this channel. The possible options are: major, minor, metadata, none.
* `--apikey [key]` API key to link to your account.

## Disable updates strategy

There are a few ways to handle disabling updates for too old versions.\
Capgo cannot update native code thus an update from a version with the old native code to a version with the updated native code should not be possible.
There are a couple of ways to achieve that.

First, the `major` strategy. It prevents an update from `0.0.0` -> `1.0.0`. The major is the highlighted number (**1**.0.0 and **0**.0.0).\
Second is the `minor` strategy. It prevents an update from `0.0.0` -> `1.1.0` or an update from `1.1.0` to `1.2.0`.
**BE AWARE** this strategy does not prevent an update from `0.1.0` -> `1.1.0`

Third, the `patch` strategy. It was added into capgo as a very strict mode. It's not recomended to be used unless you fully understand how it works.
In order for it to accept a update the following conditions must be meet:
 - The major is the same between the new and the old version
 - The minor is the same between the new and the old version
 - The patch of the new version if greater then the patch of the old version

Here is an example of which scenarios the update is allowed or denied

 - 0.0.311 -> 0.0.314 ✅
 - 0.0.0 -> 0.0.314 ✅
 - 0.0.316 -> 0.0.314 ❌
 - 0.1.312 -> 0.0.314 ❌
 - 1.0.312 -> 0.0.314 ❌

Lastly the most complicated strategy. The `metadata` strategy.\
First you need to know that initially after you enable it the updates **WILL** fail as the channel is lacking the required metadata.\
If the channel is lacking metadata you will see a message like this:
<img src="/fail-metadata.webp" alt="Cannot find metadata"/>

If you see something like this you know that you have to go to the current bundle for the failing channel and set the metadata.\
First, figure out what channel is failing. You can do that by looking at the `misconfigured` column
<img src="/misconfigured-table.webp" alt="Misconfigured table"/>

Then go to the failing channel and click on `Bundle number`. This should take you to the bundle page.
<img src="/fail-channel-show.webp" alt="Locate failing channel"/>

Once there fill the `Minimal update version` field. This should be a [semver](https://devhints.io/semver/).\
If the value you pass is not a semver you will get an error, but if everything goes correctly you should see something like this:
<img src="/set-min-update-version.webp" alt="Set min version"/>

Now, you likely do not want to set this data manually every time you update. Fortunately, the CLI will prevent you from sending an update without this metadata
<img src="/cli-fail-no-metadata.webp" alt="CLI fail no metadata"/>

To properly upload a bundle when using the `metadata` option you need to pass the `--min-update-version` with the valid semver. Something like this:
<img src="/cli-upload-with-metadata.webp" alt="CLI upload with metadata"/>

The `--min-update-version` is not the ONLY way to do compatibility.
There also exists the `--auto-min-update-version`. Here is how it works.

First, it takes a look at the version curently uploaded to the channel. It checks compatibility same as `bundle compatibility` command would.
Second, if the new version is 100% compatible it reuses the `min_update_version` from the latest version in the channel.
If not, then it sets the `min_update_version` to the bundle number of the newly uploaded version.

You will always get an information what is the `min_update_version` when using this option. It will look something like this:
<img src="/min_update_version_info.webp" alt="Min update version"/>

If the new version is not compatible it should look something like this
<img src="/min_update_version_not_compatible.webp" alt="Min update version not compatible"/>

## End-to-End encryption (Trustless)

Capgo supports end-to-end encryption, this means that your bundle(code) is encrypted before sent to the cloud and decrypted on the device. For that, you need to generate an RSA key pair, you can use the following command to generate it.

The encryption system is a combination of RSA and AES, the RSA key is used to encrypt the AES key, and the AES key is used to encrypt the file.

See below for more information about the encryption system.

<figure><img src="/crypto_explained.png" alt=""><figcaption><p>Ecryption schema</p></figcaption></figure>

Ecryption schema

### Create key for your app

`npx @capgo/cli key create`

Optionally, you can give: `--force` to overwrite the existing key. This command will create for you a key pair in your app, and will ask you to save the private key in a safe place. It's recommended to not git commit the private key, and to not share it with anyone.

> After your local test, remove the key from the config file and add it on the CI step with `key save`

### Save key in your app config

`npx @capgo/cli key save`

Optionally, you can give:

`--key [/path/to/my/private_key]` the path of your private key.

`--key-data [privateKey]` the private key data, if you want to use inline. This command is useful if you followed the recommendation and didn't commit the key in your app, and in the config.

## Ci integration

To automate your work, I recommend you make GitHub action do the job of pushing to our server

[GitHub action tutorial](https://capgo.app/blog/automatic-build-and-release-with-github-actions/)

## Our demo app

[GitHub - Cap-go/demo-app](https://github.com/Cap-go/demo-app/)

Don’t forget to configure CI env variable with your API key

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
