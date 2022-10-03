// import semver from 'semver'

// eslint-disable-next-line max-len
const regex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/
const versions = ['20220929.0.0+7c146f40', 'v1.2.3']
// check if version is valid
for (const version of versions) {
    if (!regex.test(version)) {
        console.log(`Your version name ${version}, is not valid it should follow semver convention : https://semver.org/`);
    } else {
        console.log('valid')
    }
}
