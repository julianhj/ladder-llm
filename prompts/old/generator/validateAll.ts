import fs from 'fs';
import path from 'path';
import readline from 'readline';

async function validateFile(filePath: string): Promise<boolean> {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let valid = true;
  let lineNumber = 0;
  for await (const line of rl) {
    lineNumber++;
    try {
      const obj = JSON.parse(line);
      if (typeof obj.prompt !== 'string' || typeof obj.completion !== 'string') {
        console.error(`Invalid prompt/completion at ${filePath}:${lineNumber}`);
        valid = false;
      }
    } catch (e) {
      console.error(`Invalid JSON at ${filePath}:${lineNumber} - ${(e as Error).message}`);
      valid = false;
    }
  }
  return valid;
}

async function validateAllFiles(dir: string) {
  let allValid = true;
  const files = fs.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      const valid = await validateAllFiles(fullPath);
      allValid = allValid && valid;
    } else if (file.name.endsWith('.jsonl')) {
      const valid = await validateFile(fullPath);
      allValid = allValid && valid;
      if (valid) {
        console.log(`✅ ${fullPath} is valid.`);
      }
    }
  }

  return allValid;
}

(async () => {
  const rootDir = './prompts/generator/training_data';
  const valid = await validateAllFiles(rootDir);
  if (!valid) {
    console.error('Some files failed validation.');
    process.exit(1);
  } else {
    console.log('All files are valid!');
  }
})();
