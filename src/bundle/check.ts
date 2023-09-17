import fs from "fs";
import path from "path";

const searchInFile = (filePath: string, searchString: string) => {
  const content = fs.readFileSync(filePath, "utf8");
  return content.includes(searchString);
};

export const searchInDirectory = (dirPath: string, searchString: string) => {
  const files = fs.readdirSync(dirPath);
  let found = false;

  files.forEach((file) => {
    const filePath = path.join(dirPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      found = searchInDirectory(filePath, searchString);
    } else if (stats.isFile() && path.extname(filePath) === ".js") {
      if (searchInFile(filePath, searchString)) {
        found = true;
      }
    }
  });

  return found;
};
