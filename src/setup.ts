/**
 * Interactive setup run after npm install cstesting.
 * Asks: language (TypeScript / JavaScript), then (for TS) whether to create Page Object Model.
 * Only runs when stdin is a TTY (skips in CI).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';

/** Get path to templates folder (next to dist when published). */
export function getTemplatesDir(): string {
  return path.join(__dirname, '..', 'templates');
}

/** When running from node_modules/cstesting (postinstall), project root is two levels up. */
export function getProjectRoot(): string {
  const cwd = process.cwd();
  const normalized = path.normalize(cwd);
  if (normalized.endsWith(path.join('node_modules', 'cstesting')) || normalized.includes(path.join('node_modules', 'cstesting') + path.sep)) {
    return path.resolve(cwd, '..', '..');
  }
  return cwd;
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve((answer || '').trim()));
  });
}

function createDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyTemplate(src: string, dest: string): void {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

/** Run interactive setup: language choice, then POM (for TypeScript), then scaffold. */
export async function runSetup(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log('CSTesting installed. Run "npx cstesting init" to set up your project (language & Page Object Model).');
    return;
  }

  const projectRoot = getProjectRoot();
  const templatesDir = getTemplatesDir();
  if (!fs.existsSync(templatesDir)) {
    console.error('CSTesting: templates not found. Run "npx cstesting init" from your project later.');
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\nCSTesting setup\n');

  let lang: 'typescript' | 'javascript' = 'javascript';
  const langAnswer = await ask(rl, 'Which language do you want? 1. TypeScript  2. JavaScript (1/2): ');
  if (langAnswer === '1' || langAnswer.toLowerCase() === 'typescript') {
    lang = 'typescript';
  }

  let createPOM = false;
  if (lang === 'typescript') {
    const pomAnswer = await ask(rl, 'Do you want to create Page Object Model? (yes/no): ');
    createPOM = /^y(es)?$/i.test(pomAnswer);
  } else {
    const pomAnswer = await ask(rl, 'Do you want to create Page Object Model? (yes/no): ');
    createPOM = /^y(es)?$/i.test(pomAnswer);
  }

  rl.close();

  const pagesDir = path.join(projectRoot, 'pages');
  const testsDir = path.join(projectRoot, 'tests');

  if (createPOM) {
    createDir(pagesDir);
    createDir(testsDir);
    if (lang === 'typescript') {
      copyTemplate(path.join(templatesDir, 'pages', 'HomePage.ts'), path.join(pagesDir, 'HomePage.ts'));
      copyTemplate(path.join(templatesDir, 'tests', 'home.test.ts'), path.join(testsDir, 'home.test.ts'));
      console.log('\n  Created: pages/HomePage.ts');
      console.log('  Created: tests/home.test.ts');
      console.log('\nPage Object Model (TypeScript) ready. Install dev deps: npm install -D typescript ts-node');
      console.log('Run tests: npx cstesting tests/\n');
    } else {
      copyTemplate(path.join(templatesDir, 'pages', 'HomePage.js'), path.join(pagesDir, 'HomePage.js'));
      copyTemplate(path.join(templatesDir, 'tests', 'home.test.js'), path.join(testsDir, 'home.test.js'));
      console.log('\n  Created: pages/HomePage.js');
      console.log('  Created: tests/home.test.js');
      console.log('\nPage Object Model (JavaScript) ready. Run tests: npx cstesting tests/\n');
    }
  } else {
    createDir(testsDir);
    if (lang === 'typescript') {
      copyTemplate(path.join(templatesDir, 'tests', 'sample.test.ts'), path.join(testsDir, 'sample.test.ts'));
      console.log('\n  Created: tests/sample.test.ts');
      console.log('\nTypeScript tests ready. Install dev deps: npm install -D typescript ts-node');
      console.log('Run tests: npx cstesting tests/\n');
    } else {
      copyTemplate(path.join(templatesDir, 'tests', 'sample.test.js'), path.join(testsDir, 'sample.test.js'));
      console.log('\n  Created: tests/sample.test.js');
      console.log('\nJavaScript tests ready. Run tests: npx cstesting tests/\n');
    }
  }
}
