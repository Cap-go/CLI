import Foundation
import SSZipArchive

func verifyZipFile(zipFilePath: String) -> Bool {
    let destUnZip = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("extracted")
    
    var unzipError: NSError?
    let success = SSZipArchive.unzipFile(atPath: zipFilePath,
                                         toDestination: destUnZip.path,
                                         preserveAttributes: true,
                                         overwrite: true,
                                         nestedZipLevel: 1,
                                         password: nil,
                                         error: &unzipError,
                                         delegate: nil,
                                         progressHandler: { (entry, _, _, _) in
                                            if entry.contains("\\") {
                                                print("Windows path is not supported: \(entry)")
                                                exit(1)
                                            }
                                            
                                            let fileURL = destUnZip.appendingPathComponent(entry)
                                            let canonicalPath = fileURL.path
                                            let canonicalDir = destUnZip.path
                                            
                                            if !canonicalPath.hasPrefix(canonicalDir) {
                                                print("SecurityException, Failed to ensure directory is the start path: \(canonicalDir) of \(canonicalPath)")
                                                exit(1)
                                            }
                                         },
                                         completionHandler: nil)
    
    if !success || unzipError != nil {
        print("Failed to unzip file: \(zipFilePath)")
        print("Error: \(unzipError?.localizedDescription ?? "")")
        return false
    }
    
    print("ZIP file is valid: \(zipFilePath)")
    return true
}

let zipFilePaths = CommandLine.arguments.dropFirst()

if zipFilePaths.isEmpty {
    print("Usage: swift run VerifyZip <zip-file1> <zip-file2> ...")
    exit(1)
}

for zipFilePath in zipFilePaths {
    if !verifyZipFile(zipFilePath: zipFilePath) {
        exit(1)
    }
}
