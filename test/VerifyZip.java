import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class VerifyZip {
    public static void main(String[] args) {
        if (args.length < 1) {
            System.out.println("Usage: java VerifyZip <zip-file>");
            System.exit(1);
        }

        String zipFilePath = args[0];
        File file = new File(zipFilePath);

        if (!file.exists()) {
            System.out.println("File not found: " + zipFilePath);
            System.exit(1);
        }

        try (ZipInputStream zis = new ZipInputStream(new FileInputStream(file))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                System.out.println("Extracting: " + entry.getName());
                zis.closeEntry();
            }
            System.out.println("ZIP file is valid: " + zipFilePath);
        } catch (IOException e) {
            System.out.println("Failed to process ZIP file: " + zipFilePath);
            e.printStackTrace();
            System.exit(1);
        }
    }
}
