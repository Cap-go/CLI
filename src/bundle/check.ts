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

export const checkIndexPosition = (dirPath: string): boolean => {
  // look for index.html in the root folder or if there only one folder in the root folder look for index.html in this folder
  const files = fs.readdirSync(dirPath);
  if (files.length === 1) {
    const filePath = path.join(dirPath, files[0]);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      return checkIndexPosition(filePath);
    }
  } 
  const index = files.indexOf("index.html");
  if (index > -1) {
    return true;
  }
  return false;
};
