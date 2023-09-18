import fs from "fs";
import path from "path";

const searchInFile = (filePath: string, searchString: string) => {
  const content = fs.readFileSync(filePath, "utf8");
  return content.includes(searchString);
};

export const searchInDirectory = (dirPath: string, searchString: string) => {
  const files = fs.readdirSync(dirPath);
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      if (searchInDirectory(filePath, searchString)) {
        return true;
      }
    } else if (stats.isFile() && path.extname(filePath) === ".js") {
      if (searchInFile(filePath, searchString)) {
        return true;
      }
    }
  }

  return false;
};
