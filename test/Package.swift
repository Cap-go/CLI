// swift-tools-version:5.5

import PackageDescription

let package = Package(
    name: "VerifyZip",
    dependencies: [
        .package(url: "https://github.com/ZipArchive/ZipArchive.git", from: "2.5.5")
    ],
    targets: [
        .executableTarget(
            name: "VerifyZip",
            dependencies: [.product(name: "ZipArchive", package: "ZipArchive")]
        )
    ]
)
