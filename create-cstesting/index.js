#!/usr/bin/env node
/**
 * npm create cstesting@latest  |  npm init cstesting@latest
 * Playwright-style project bootstrap for CSTesting.
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

function ensurePackageJson(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) return;
  const name = path.basename(cwd) || 'cstesting-project';
  fs.writeFileSync(
    pkgPath,
    JSON.stringify({ name, version: '1.0.0', private: true }, null, 2) + '\n',
    'utf8'
  );
  console.log('Created package.json\n');
}

async function main() {
  const cwd = process.cwd();
  ensurePackageJson(cwd);

  let runInitProject;
  try {
    runInitProject = require('cstesting/init').runInitProject;
  } catch {
    console.log('Installing cstesting…\n');
    const install = spawnSync('npm', ['install', 'cstesting@latest', '--no-save'], {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (install.status !== 0) {
      console.error('Failed to install cstesting. Run: npm install cstesting');
      process.exit(1);
    }
    runInitProject = require('cstesting/init').runInitProject;
  }

  try {
    await runInitProject({ projectRoot: cwd });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
