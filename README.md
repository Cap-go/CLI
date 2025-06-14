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

- 🚀 [Init](#init)
- 👨‍⚕️ [Doctor](#doctor)
- 🔑 [Login](#login)
- 📦 [Bundle](#bundle)
  - [Upload](#bundle-upload)
  - [Compatibility](#bundle-compatibility)
  - [Delete](#bundle-delete)
  - [List](#bundle-list)
  - [Cleanup](#bundle-cleanup)
  - [Encrypt](#bundle-encrypt)
  - [Decrypt](#bundle-decrypt)
  - [Zip](#bundle-zip)
- 📱 [App](#app)
  - [Add](#app-add)
  - [Delete](#app-delete)
  - [List](#app-list)
  - [Debug](#app-debug)
  - [Setting](#app-setting)
  - [Set](#app-set)
- 📢 [Channel](#channel)
  - [Add](#channel-add)
  - [Delete](#channel-delete)
  - [List](#channel-list)
  - [CurrentBundle](#channel-currentBundle)
  - [Set](#channel-set)
- 🔐 [Key](#key)
  - [Save](#key-save)
  - [Create](#key-create)
  - [Delete_old](#key-delete_old)
- 👤 [Account](#account)
  - [Id](#account-id)

## <a id="init"></a> 🚀 **Init**

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

## <a id="options"></a> Options

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-n,** | <code>string</code> | App name for display in Capgo Cloud |
| **-i,** | <code>string</code> | App icon path for display in Capgo Cloud |
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |


## <a id="doctor"></a> 👨‍⚕️ **Doctor**

```bash
npx @capgo/cli@latest doctor
```

👨‍⚕️ Check if your Capgo app installation is up-to-date and gather information useful for bug reports.
This command helps diagnose issues with your setup.

**Example:**

```bash
npx @capgo/cli@latest doctor
```

## <a id="options"></a> Options

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **--package-json** | <code>string</code> | A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json) |


## <a id="login"></a> 🔑 **Login**

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

## <a id="options"></a> Options

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **--local** | <code>boolean</code> | Only save in local folder, git ignored for security. |
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |


## <a id="bundle"></a> 📦 **Bundle**

📦 Manage app bundles for deployment in Capgo Cloud, including upload, compatibility checks, and encryption.

### <a id="bundle-upload"></a> ⬆️ **Upload**

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
| **--partial** | <code>boolean</code> | Upload partial files to Capgo cloud (deprecated, use --delta instead) |
| **--partial-only** | <code>boolean</code> | Upload only partial files to Capgo cloud, skip the zipped file, useful for big bundle (deprecated, use --delta-only instead) |
| **--delta** | <code>boolean</code> | Upload delta update to Capgo cloud (old name: --partial) |
| **--delta-only** | <code>boolean</code> | Upload only delta update to Capgo cloud, skip the zipped file, useful for big bundle (old name: --partial-only) |
| **--encrypted-checksum** | <code>string</code> | An encrypted checksum (signature). Used only when uploading an external bundle. |
| **--auto-set-bundle** | <code>boolean</code> | Set the bundle in capacitor.config.json |
| **--dry-upload** | <code>boolean</code> | Dry upload the bundle process, mean it will not upload the files but add the row in database (Used by Capgo for internal testing) |
| **--package-json** | <code>string</code> | A list of paths to package.json. Useful for monorepos (comma separated ex: ../../package.json,./package.json) |
| **--node-modules** | <code>string</code> | A list of paths to node_modules. Useful for monorepos (comma separated ex: ../../node_modules,./node_modules) |
| **--encrypt-partial** | <code>boolean</code> | Encrypt the partial update files (automatically applied for updater > 6.14.4) |
| **--delete-linked-bundle-on-upload** | <code>boolean</code> | Locates the currently linked bundle in the channel you are trying to upload to, and deletes it |
| **--no-brotli-patterns** | <code>string</code> | Glob patterns for files to exclude from brotli compression (comma-separated) |
| **--disable-brotli** | <code>boolean</code> | Completely disable brotli compression even if updater version supports it |
| **--silent-fail** | <code>boolean</code> | Exit successfully if bundle version already exists, useful for CI/CD workflows with monorepos |
| **--self-assign** | <code>boolean</code> | Allow device to self-assign to this channel, this will update the channel |
| **--supa-host** | <code>string</code> | Supabase host URL, for self-hosted Capgo or testing |
| **--supa-anon** | <code>string</code> | Supabase anon token, for self-hosted Capgo or testing |

### <a id="bundle-compatibility"></a> 🧪 **Compatibility**

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
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |

### <a id="bundle-delete"></a> 🗑️ **Delete**

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
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |

### <a id="bundle-list"></a> 📋 **List**

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
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |

### <a id="bundle-cleanup"></a> 🧹 **Cleanup**

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
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |

### <a id="bundle-encrypt"></a> 🔒 **Encrypt**

```bash
npx @capgo/cli@latest bundle encrypt
```

🔒 Encrypt a zip bundle using the new encryption method for secure external storage or testing.
Used with external sources or for testing, prints ivSessionKey for upload or decryption.
The command will return the ivSessionKey for upload or decryption.
The checksum is the checksum of the zip file, you can get it with the --json option of the zip command.

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

### <a id="bundle-decrypt"></a> 🔓 **Decrypt**

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

### <a id="bundle-zip"></a> 🔹 **Zip**

```bash
npx @capgo/cli@latest bundle zip
```

🗜️ Create a zip file of your app bundle for upload or local storage.
Useful for preparing bundles before encryption or upload.
The command will return the checksum of the zip file, you can use it to encrypt the zip file with the --key-v2 option.

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


## <a id="app"></a> 📱 **App**

📱 Manage your Capgo app settings and configurations in Capgo Cloud.

### <a id="app-add"></a> ➕ **Add**

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
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |

### <a id="app-delete"></a> 🗑️ **Delete**

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
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |

### <a id="app-list"></a> 📋 **List**

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
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |

### <a id="app-debug"></a> 🐞 **Debug**

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
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |

### <a id="app-setting"></a> ⚙️ **Setting**

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

### <a id="app-set"></a> ⚙️ **Set**

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
| **--supa-host** | <code>string</code> | Supabase host URL for custom setups |
| **--supa-anon** | <code>string</code> | Supabase anon token for custom setups |


## <a id="channel"></a> 📢 **Channel**

📢 Manage distribution channels for app updates in Capgo Cloud, controlling how updates are delivered to devices.

### <a id="channel-add"></a> ➕ **Add**

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
| **--self-assign** | <code>boolean</code> | Allow device to self-assign to this channel |
| **-a,** | <code>string</code> | API key to link to your account |
| **--supa-host** | <code>string</code> | Supabase host URL, for self-hosted Capgo or testing |
| **--supa-anon** | <code>string</code> | Supabase anon token, for self-hosted Capgo or testing |

### <a id="channel-delete"></a> 🗑️ **Delete**

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
| **--success-if-not-found** | <code>boolean</code> | Success if the channel is not found |
| **--supa-host** | <code>string</code> | Supabase host URL, for self-hosted Capgo or testing |
| **--supa-anon** | <code>string</code> | Supabase anon token, for self-hosted Capgo or testing |

### <a id="channel-list"></a> 📋 **List**

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
| **--supa-host** | <code>string</code> | Supabase host URL, for self-hosted Capgo or testing |
| **--supa-anon** | <code>string</code> | Supabase anon token, for self-hosted Capgo or testing |

### <a id="channel-currentBundle"></a> 📦 **CurrentBundle**

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
| **--supa-host** | <code>string</code> | Supabase host URL, for self-hosted Capgo or testing |
| **--supa-anon** | <code>string</code> | Supabase anon token, for self-hosted Capgo or testing |

### <a id="channel-set"></a> ⚙️ **Set**

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
| **--latest-remote** | <code>boolean</code> | Get the latest bundle uploaded in capgo cloud and set it to the channel |
| **--latest** | <code>boolean</code> | Get the latest version key in the package.json to set it to the channel |
| **--downgrade** | <code>boolean</code> | Allow to downgrade to version under native one |
| **--no-downgrade** | <code>boolean</code> | Disable downgrade to version under native one |
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
| **--ignore-metadata-check** | <code>boolean</code> | Ignore checking node_modules compatibility if present in the bundle |
| **--supa-host** | <code>string</code> | Supabase host URL, for self-hosted Capgo or testing |
| **--supa-anon** | <code>string</code> | Supabase anon token, for self-hosted Capgo or testing |


## <a id="key"></a> 🔐 **Key**

🔐 Manage encryption keys for secure bundle distribution in Capgo Cloud, supporting end-to-end encryption with RSA and AES combination.

### <a id="key-save"></a> 🔹 **Save**

```bash
npx @capgo/cli@latest key save
```

💾 Save the public key in the Capacitor config, useful for CI environments.
Recommended not to commit the key for security.

**Example:**

```bash
npx @capgo/cli@latest key save --key ./path/to/key.pub
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-f,** | <code>string</code> | Force generate a new one |
| **--key** | <code>string</code> | Key path to save in Capacitor config |
| **--key-data** | <code>string</code> | Key data to save in Capacitor config |

### <a id="key-create"></a> 🔨 **Create**

```bash
npx @capgo/cli@latest key create
```

🔨 Create a new encryption key pair for end-to-end encryption in Capgo Cloud.
Do not commit or share the private key; save it securely.
This command will create a new key pair with the name .capgo_key_v2 and .capgo_key_v2.pub in the root of the project.
The public key is used to decrypt the zip file in the mobile app.
The public key will also be stored in the capacitor config. This is the one used in the mobile app. The file is just a backup.
The private key is used to encrypt the zip file in the CLI.

**Example:**

```bash
npx @capgo/cli@latest key create
```

**Options:**

| Param          | Type          | Description          |
| -------------- | ------------- | -------------------- |
| **-f,** | <code>string</code> | Force generate a new one |

### <a id="key-delete_old"></a> 🗑️ **Delete_old**

```bash
npx @capgo/cli@latest key delete_old
```

🧹 Delete the old encryption key from the Capacitor config to ensure only the current key is used.

**Example:**

```bash
npx @capgo/cli@latest key delete_old
```


## <a id="account"></a> 👤 **Account**

👤 Manage your Capgo account details and retrieve information for support or collaboration.

### <a id="account-id"></a> 🔹 **Id**

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
