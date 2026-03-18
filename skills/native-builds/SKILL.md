---
name: native-builds
description: Use when working with Capgo Cloud native iOS and Android build requests, credential storage, credential updates, and build output upload settings.
---

# Capgo CLI Native Builds

Use this skill for Capgo Cloud native iOS and Android build workflows.

## Core build request

### `build request [appId]`

- Example: `npx @capgo/cli@latest build request com.example.app --platform ios --path .`
- Notes:
  - Zips the current project directory and uploads it to Capgo for building.
  - Builds are processed for store distribution.
  - Credentials are never stored permanently on Capgo servers.
  - Build outputs can be uploaded for time-limited download links.
  - Before requesting a build, save credentials with `build credentials save`.
- Core options:
  - `--path <path>`
  - `--platform <platform>`: `ios` or `android`, required.
  - `--build-mode <buildMode>`: `debug` or `release`.
  - `-a, --apikey <apikey>`
  - `--verbose`

#### iOS request options

- `--build-certificate-base64 <cert>`
- `--p12-password <password>`
- `--apple-id <email>`
- `--apple-app-specific-password <password>`
- `--apple-key-id <id>`
- `--apple-issuer-id <id>`
- `--apple-key-content <content>`
- `--app-store-connect-team-id <id>`
- `--ios-scheme <scheme>`
- `--ios-target <target>`
- `--ios-distribution <mode>`: `app_store` or `ad_hoc`
- `--ios-provisioning-profile <mapping>`: repeatable path or `bundleId=path`

#### Android request options

- `--android-keystore-file <keystore>`
- `--keystore-key-alias <alias>`
- `--keystore-key-password <password>`
- `--keystore-store-password <password>`
- `--play-config-json <json>`
- `--android-flavor <flavor>`

#### Output behavior options

- `--no-playstore-upload`: skip Play Store upload for the build, requires `--output-upload`
- `--output-upload`
- `--no-output-upload`
- `--output-retention <duration>`: `1h` to `7d`
- `--skip-build-number-bump`
- `--no-skip-build-number-bump`

## Local credential management

Credentials are stored locally, either globally in `~/.capgo-credentials/credentials.json` or locally in `.capgo-credentials.json`.

### `build credentials save`

- Required before build requests.
- Supports global storage by default and local storage with `--local`.
- Example iOS flow:

```bash
npx @capgo/cli build credentials save --platform ios \
  --certificate ./cert.p12 --p12-password "password" \
  --ios-provisioning-profile ./profile.mobileprovision \
  --apple-key ./AuthKey.p8 --apple-key-id "KEY123" \
  --apple-issuer-id "issuer-uuid" --apple-team-id "team-id"
```

- Example multi-target iOS flow:

```bash
npx @capgo/cli build credentials save --platform ios \
  --ios-provisioning-profile ./App.mobileprovision \
  --ios-provisioning-profile com.example.widget=./Widget.mobileprovision
```

- Example Android flow:

```bash
npx @capgo/cli build credentials save --platform android \
  --keystore ./release.keystore --keystore-alias "my-key" \
  --keystore-key-password "key-pass" \
  --play-config ./service-account.json
```

- Core options:
  - `--appId <appId>`
  - `--platform <platform>`
  - `--local`
  - `--output-upload`, `--no-output-upload`
  - `--output-retention <duration>`
  - `--skip-build-number-bump`, `--no-skip-build-number-bump`

#### iOS credential save options

- `--certificate <path>`
- `--ios-provisioning-profile <mapping>`
- `--p12-password <password>`
- `--apple-key <path>`
- `--apple-key-id <id>`
- `--apple-issuer-id <id>`
- `--apple-team-id <id>`
- `--ios-distribution <mode>`
- `--apple-id <email>`
- `--apple-app-password <password>`

#### Android credential save options

- `--keystore <path>`
- `--keystore-alias <alias>`
- `--keystore-key-password <password>`
- `--keystore-store-password <password>`
- `--play-config <path>`
- `--android-flavor <flavor>`

### `build credentials list`

- Examples:
  - `npx @capgo/cli build credentials list`
  - `npx @capgo/cli build credentials list --appId com.example.app`
- Options:
  - `--appId <appId>`
  - `--local`

### `build credentials clear`

- Examples:
  - `npx @capgo/cli build credentials clear`
  - `npx @capgo/cli build credentials clear --local`
  - `npx @capgo/cli build credentials clear --appId com.example.app --platform ios`
- Options:
  - `--appId <appId>`
  - `--platform <platform>`
  - `--local`

### `build credentials update`

- Use to update specific credential fields without re-entering all data.
- Platform is auto-detected from the supplied options.
- Examples:
  - `npx @capgo/cli build credentials update --ios-provisioning-profile ./new-profile.mobileprovision`
  - `npx @capgo/cli build credentials update --local --keystore ./new-keystore.jks`
- Core options:
  - `--appId <appId>`
  - `--platform <platform>`
  - `--local`
  - `--overwrite-ios-provisioning-map`
  - `--output-upload`, `--no-output-upload`
  - `--output-retention <duration>`
  - `--skip-build-number-bump`, `--no-skip-build-number-bump`
- Supports the same iOS and Android credential fields as `build credentials save`.

### `build credentials migrate`

- Example: `npx @capgo/cli build credentials migrate --platform ios`
- Notes:
  - Converts `BUILD_PROVISION_PROFILE_BASE64` to `CAPGO_IOS_PROVISIONING_MAP`.
  - Discovers the main bundle ID from the Xcode project automatically.
- Options:
  - `--appId <appId>`
  - `--platform <platform>`: only `ios`
  - `--local`

## Supporting docs

- iOS setup: `https://capgo.app/docs/cli/cloud-build/ios/`
- Android setup: `https://capgo.app/docs/cli/cloud-build/android/`
