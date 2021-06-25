import program from 'commander';
import fsExtra from 'fs-extra';
import * as upath from 'upath';

program
  .option('-u, --username <username>', 'username to greet')
  .option('-w, --write <write>', 'write to file? Y/N')
  .option('-o, --out-folder <out-folder>', 'folder to write results to');

program.parse(process.argv);
const options = program.opts();

start();
async function start() {
  const { username, write, outFolder = 'output' } = options;
  console.log(`Welcome, ${username}`);
  if (write?.toLowerCase() === 'y') {
    const targetDir = upath.join(outFolder, 'another-dir');
    await fsExtra.ensureDir(targetDir);
    const filePath = upath.join(targetDir, `${Date.now()}.json`);
    await fsExtra.writeJson(filePath, {
      date: new Date(),
      username,
      event: 'CLI was launched',
    });
  }
}
