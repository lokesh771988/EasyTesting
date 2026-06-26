/**
 * Playwright-style project initializer for CSTesting.
 * Used by: npx cstesting init | npm create cstesting@latest
 */

import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { spawnSync } from 'child_process';

export type InitLanguage = 'typescript' | 'javascript';

export interface InitProjectOptions {
  projectRoot?: string;
  /** Skip prompts and use defaults / provided values. */
  yes?: boolean;
  language?: InitLanguage;
  testsDir?: string;
  addGithubActions?: boolean;
  verifyBrowsers?: boolean;
}

export interface InitProjectResult {
  language: InitLanguage;
  testsDir: string;
  addGithubActions: boolean;
  verifyBrowsers: boolean;
}

/** Path to bundled templates (next to dist when published). */
export function getTemplatesDir(): string {
  return path.join(__dirname, '..', 'templates');
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve((answer || '').trim()));
  });
}

function askWithDefault(rl: readline.Interface, prompt: string, defaultValue: string): Promise<string> {
  return ask(rl, `${prompt} · ${defaultValue} `).then((a) => a || defaultValue);
}

async function askYesNo(
  rl: readline.Interface,
  prompt: string,
  defaultYes: boolean
): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await ask(rl, `${prompt} (${hint}): `);
  if (!answer) return defaultYes;
  if (/^y(es)?$/i.test(answer)) return true;
  if (/^n(o)?$/i.test(answer)) return false;
  return defaultYes;
}

function createDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    throw new Error(`Template missing: ${src}`);
  }
  createDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return { name: path.basename(path.resolve(filePath, '..')), version: '1.0.0', private: true };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function writeJsonFile(filePath: string, data: Record<string, unknown>): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function getCstestingVersion(): string {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'latest';
  } catch {
    return 'latest';
  }
}

function mergePackageJson(projectRoot: string, language: InitLanguage, testsDir: string): void {
  const pkgPath = path.join(projectRoot, 'package.json');
  const pkg = readJsonFile(pkgPath) as {
    name?: string;
    version?: string;
    private?: boolean;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  pkg.scripts = { ...pkg.scripts, test: `cstesting ${testsDir}/` };
  pkg.dependencies = { ...pkg.dependencies, cstesting: `^${getCstestingVersion()}` };

  if (language === 'typescript') {
    pkg.devDependencies = {
      ...pkg.devDependencies,
      typescript: '^5.3.0',
      'ts-node': '^10.9.0',
      '@types/node': '^20.10.0',
    };
  }

  writeJsonFile(pkgPath, pkg as Record<string, unknown>);
}

function writeTsConfig(projectRoot: string, testsDir: string): void {
  const templatesDir = getTemplatesDir();
  const templatePath = path.join(templatesDir, 'tsconfig.init.json');
  const includeGlob = `{${testsDir}/**/*.ts,pages/**/*.ts}`;
  const content = fs
    .readFileSync(templatePath, 'utf8')
    .replace('{{INCLUDE_GLOB}}', includeGlob);
  fs.writeFileSync(path.join(projectRoot, 'tsconfig.json'), content, 'utf8');
}

function writeGithubWorkflow(projectRoot: string): void {
  const templatesDir = getTemplatesDir();
  const src = path.join(templatesDir, 'github', 'workflows', 'cstesting.yml');
  const dest = path.join(projectRoot, '.github', 'workflows', 'cstesting.yml');
  copyFile(src, dest);
}

function scaffoldTests(
  projectRoot: string,
  templatesDir: string,
  language: InitLanguage,
  testsDir: string
): string {
  const testsPath = path.join(projectRoot, testsDir);
  createDir(testsPath);
  const sampleName = language === 'typescript' ? 'sample.test.ts' : 'sample.test.js';
  const src = path.join(templatesDir, 'tests', sampleName);
  const dest = path.join(testsPath, sampleName);
  copyFile(src, dest);
  return dest;
}

function runNpmInstall(projectRoot: string): boolean {
  console.log('\nInstalling npm packages…');
  const result = spawnSync('npm', ['install'], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

async function verifyChromeInstalled(): Promise<boolean> {
  try {
    const { launch } = await import('chrome-launcher');
    const chrome = await launch({ chromeFlags: ['--headless=new', '--disable-gpu'] });
    await chrome.kill();
    return true;
  } catch {
    return false;
  }
}

async function promptForOptions(
  projectRoot: string,
  defaults: InitProjectOptions
): Promise<InitProjectResult> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║       CSTesting — new project setup              ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  let defaultTestsDir = 'tests';
  if (fs.existsSync(path.join(projectRoot, 'tests'))) {
    defaultTestsDir = 'e2e';
  }

  const langAnswer = await askWithDefault(
    rl,
    'Do you want to use TypeScript or JavaScript?',
    defaults.language === 'javascript' ? 'JavaScript' : 'TypeScript'
  );
  const language: InitLanguage =
    /^j(s|avascript)?$/i.test(langAnswer) || langAnswer === '2' ? 'javascript' : 'typescript';

  const testsDir = await askWithDefault(
    rl,
    'Where to put your end-to-end tests?',
    defaults.testsDir ?? defaultTestsDir
  );

  const addGithubActions = await askYesNo(
    rl,
    'Add a GitHub Actions workflow? (recommended for CI)',
    defaults.addGithubActions ?? true
  );

  const verifyBrowsers = await askYesNo(
    rl,
    'Verify Chrome is installed for browser tests?',
    defaults.verifyBrowsers ?? true
  );

  rl.close();

  return { language, testsDir, addGithubActions, verifyBrowsers };
}

/** Interactive or non-interactive project scaffold (Playwright-style). */
export async function runInitProject(options: InitProjectOptions = {}): Promise<InitProjectResult> {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const templatesDir = getTemplatesDir();

  if (!fs.existsSync(templatesDir)) {
    throw new Error('CSTesting templates not found. Reinstall cstesting or use a published version.');
  }

  const interactive = !options.yes && process.stdin.isTTY;

  let config: InitProjectResult;

  if (interactive) {
    config = await promptForOptions(projectRoot, options);
  } else {
    let defaultTestsDir = 'tests';
    if (fs.existsSync(path.join(projectRoot, 'tests'))) {
      defaultTestsDir = 'e2e';
    }
    config = {
      language: options.language ?? 'typescript',
      testsDir: options.testsDir ?? defaultTestsDir,
      addGithubActions: options.addGithubActions ?? false,
      verifyBrowsers: options.verifyBrowsers ?? false,
    };
  }

  const { language, testsDir, addGithubActions, verifyBrowsers } = config;

  console.log('\nScaffolding project…\n');

  mergePackageJson(projectRoot, language, testsDir);

  const testFile = scaffoldTests(projectRoot, templatesDir, language, testsDir);
  console.log(`  ✓ ${path.relative(projectRoot, testFile)}`);

  if (language === 'typescript') {
    writeTsConfig(projectRoot, testsDir);
    console.log('  ✓ tsconfig.json');
  }

  if (addGithubActions) {
    writeGithubWorkflow(projectRoot);
    console.log('  ✓ .github/workflows/cstesting.yml');
  }

  const installed = runNpmInstall(projectRoot);
  if (!installed) {
    console.warn('\n  npm install failed or npm is not available. Run npm install manually.');
  }

  if (verifyBrowsers) {
    console.log('\nChecking for Chrome…');
    const ok = await verifyChromeInstalled();
    if (ok) {
      console.log('  ✓ Chrome is available (CSTesting uses your system Chrome / Edge / Firefox).');
    } else {
      console.log(
        '  ✗ Chrome was not detected. Install Google Chrome or Microsoft Edge, then run tests again.'
      );
      console.log('    Windows: https://www.google.com/chrome/');
      console.log('    macOS:   brew install --cask google-chrome');
      console.log('    Linux:   sudo apt install google-chrome-stable  (or use Edge)');
    }
  }

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Setup complete!                                 ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  console.log(`  Run tests:  npm test`);
  console.log(`  Or:         npx cstesting ${testsDir}/`);
  if (language === 'typescript') {
    console.log(`  Record:     npx cstesting record https://example.com --output ${testsDir}/flow.conf`);
  }
  console.log('');

  return config;
}
