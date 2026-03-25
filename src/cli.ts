#!/usr/bin/env node
// CSTesting CLI — discover and run test files.
// Usage: npx cstesting [pattern]  or  npx cst init
// Examples: cstesting  |  cstesting "**/*.test.js"  |  cstesting tests/  |  cstesting init

import * as path from 'path';
import * as fs from 'fs';
import { run, resetRunner } from './runner';
import { AssertionError } from './assertions';
import { writeReport } from './report';
import { runConfigFile } from './config-runner';
import type { RunResult } from './types';
import { startRecording, stopRecording, exportRecorded } from './recorder';
import { runSetup } from './setup';
import { normalizeTestTag } from './tags';

const defaultPattern = '**/*.test.js';
const TEST_EXTENSIONS = ['.test.js', '.spec.js', '.test.ts', '.spec.ts'];

function isTestFile(name: string): boolean {
  return TEST_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function findTestFiles(pattern: string, cwd: string): string[] {
  const base = pattern.split(/[/\\]/)[0];

  if (base === '**' || pattern.includes('*')) {
    const files: string[] = [];
    function walk(dir: string) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules' && e.name !== 'dist') walk(full);
        } else if (e.isFile() && isTestFile(e.name)) {
          files.push(full);
        }
      }
    }
    walk(cwd);
    return files;
  }

  const full = path.join(cwd, pattern);
  if (fs.existsSync(full) && fs.statSync(full).isFile()) return [path.resolve(full)];
  const dir = path.join(cwd, base);
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    const files: string[] = [];
    function walk(d: string) {
      const entries = fs.readdirSync(d, { withFileTypes: true });
      for (const e of entries) {
        const fullPath = path.join(d, e.name);
        if (e.isDirectory()) walk(fullPath);
        else if (isTestFile(e.name)) files.push(fullPath);
      }
    }
    walk(dir);
    return files;
  }
  return [];
}

function loadTestFile(filePath: string): void {
  const resolved = path.resolve(filePath);
  if (filePath.endsWith('.ts')) {
    try {
      require('ts-node/register');
    } catch {
      console.error(
        'TypeScript test file found but ts-node is not installed. Install it: npm install -D ts-node\n  Or compile .ts to .js and run the .js files.'
      );
      process.exit(1);
    }
  }
  require(resolved);
}

function formatError(err: Error): string {
  if (err instanceof AssertionError) {
    return `${err.message}${err.actual !== undefined ? `\n  Actual: ${String(err.actual)}` : ''}${err.expected !== undefined ? `\n  Expected: ${String(err.expected)}` : ''}`;
  }
  return err.stack || err.message;
}

/** Resolve config path: try cwd, then parent (so "node dist/cli.js foo.conf" works from dist). */
function resolveConfigPath(configPath: string): string | null {
  const cwd = process.cwd();
  let resolved = path.resolve(cwd, configPath);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  if (!configPath.includes(path.sep) && !configPath.includes('/')) {
    resolved = path.resolve(cwd, '..', configPath);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return null;
}

/** Run a config file (e.g. login.conf) and write report. */
async function runConfig(
  configPath: string,
  options?: {
    headless?: boolean;
    browser?: 'chrome' | 'edge' | 'opera' | 'firefox';
    pauseOnFailure?: boolean;
  }
): Promise<void> {
  const cwd = process.cwd();
  const resolved = resolveConfigPath(configPath);
  if (!resolved) {
    console.error(`Config file not found: ${configPath}`);
    console.error(`  (Looked in ${cwd} and parent directory. Run from project root or use: cstesting run path/to/file.conf)`);
    process.exit(1);
  }
  console.log(`Running config: ${path.relative(cwd, resolved) || configPath}\n`);
  const result = await runConfigFile(resolved, options);
  if (result.errors.length > 0) {
    console.error('\nFailed test(s):');
    for (const { suite, test, error } of result.errors) {
      console.error(`  ✗ ${suite} > ${test}`);
      console.error(`    ${error.message}`);
      if (error.stack) {
        console.error(error.stack.split('\n').slice(1, 4).map((l) => `    ${l.trim()}`).join('\n'));
      }
    }
  }
  console.log('\n' + '─'.repeat(50));
  console.log(`  Passed: ${result.passed}  Failed: ${result.failed}  Total: ${result.total}  (${result.duration}ms)`);
  const reportPath = writeReport(result, { cwd, reportDir: 'report', filename: 'report.html' });
  console.log(`  Report: ${reportPath}`);
  if (result.failed > 0) process.exit(1);
}

const FLAG_TAG = '--tag';
const FLAG_TAGS = '--tags';
const FLAG_T = '-t';

/** True if the arg looks like a file/dir pattern (path, test file, or config file). */
function looksLikePattern(arg: string): boolean {
  return arg.includes('/') || arg.includes('\\') || /\.(test|spec)\.(js|ts)$/i.test(arg) || /\.(conf|config)$/i.test(arg) || arg.includes('*');
}

/**
 * Parse argv for --tag / -t (include) and --skip-tag / --exclude-tag (exclude).
 * Tag names are normalized: @smoke and smoke match; comma-separated lists OK.
 */
function parseTagArgs(): { tags: string[]; excludeTags: string[]; pattern: string | undefined } {
  const tags: string[] = [];
  const excludeTags: string[] = [];
  let pattern: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === FLAG_TAG || a === FLAG_TAGS || a === FLAG_T) {
      if (i + 1 < argv.length) {
        tags.push(...argv[++i].split(',').map((s) => normalizeTestTag(s)).filter(Boolean));
      }
    } else if (a.startsWith('--tag=')) {
      tags.push(...a.slice(6).split(',').map((s) => normalizeTestTag(s)).filter(Boolean));
    } else if (a.startsWith('-t=')) {
      tags.push(...a.slice(3).split(',').map((s) => normalizeTestTag(s)).filter(Boolean));
    } else if (a === '--skip-tag' || a === '--skip-tags' || a === '--exclude-tag' || a === '--exclude-tags') {
      if (i + 1 < argv.length) {
        excludeTags.push(...argv[++i].split(',').map((s) => normalizeTestTag(s)).filter(Boolean));
      }
    } else if (
      a.startsWith('--skip-tag=') ||
      a.startsWith('--skip-tags=') ||
      a.startsWith('--exclude-tag=') ||
      a.startsWith('--exclude-tags=')
    ) {
      const eq = a.indexOf('=');
      excludeTags.push(...a.slice(eq + 1).split(',').map((s) => normalizeTestTag(s)).filter(Boolean));
    } else if (!a.startsWith('-') && looksLikePattern(a) && pattern === undefined) {
      pattern = a;
    }
  }
  return { tags, excludeTags, pattern };
}

/** First non-flag argument that looks like a pattern (path or test file). */
function firstPatternArg(): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === FLAG_TAG || a === FLAG_TAGS || a === FLAG_T) {
      if (i + 1 < argv.length) i++;
      continue;
    }
    if (a.startsWith('--tag=') || a.startsWith('-t=')) continue;
    if (a === '--skip-tag' || a === '--skip-tags' || a === '--exclude-tag' || a === '--exclude-tags') {
      if (i + 1 < argv.length) i++;
      continue;
    }
    if (
      a.startsWith('--skip-tag=') ||
      a.startsWith('--skip-tags=') ||
      a.startsWith('--exclude-tag=') ||
      a.startsWith('--exclude-tags=')
    ) {
      continue;
    }
    if (a.startsWith('-') && a !== '-') continue;
    if (looksLikePattern(a)) return a;
  }
  return undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('setup') || argv.includes('init')) {
    await runSetup();
    process.exit(0);
    return;
  }

  if (argv.includes('record')) {
    const outIdx = argv.indexOf('--output');
    const formatIdx = argv.indexOf('--format');
    const browserIdx = argv.indexOf('--browser');
    let output = outIdx !== -1 && argv[outIdx + 1] ? argv[outIdx + 1] : undefined;
    let format: 'conf' | 'js' | 'ts' | 'java' | 'cs' = 'conf';
    let browser: 'chrome' | 'edge' | 'opera' | 'firefox' = 'chrome';
    if (formatIdx !== -1 && argv[formatIdx + 1]) {
      const f = argv[formatIdx + 1];
      if (f === 'js' || f === 'ts' || f === 'java' || f === 'cs') format = f;
    }
    if (browserIdx !== -1 && argv[browserIdx + 1]) {
      const b = String(argv[browserIdx + 1]).toLowerCase();
      if (b === 'edge' || b === 'opera' || b === 'firefox') browser = b;
    }
    if (output && format === 'conf') {
      if (output.endsWith('.test.js') || output.endsWith('.js')) format = 'js';
      else if (output.endsWith('.test.ts') || output.endsWith('.ts')) format = 'ts';
      else if (output.endsWith('.java')) format = 'java';
      else if (output.endsWith('.cs')) format = 'cs';
    }
    const recordArgv = argv.filter(
      (a) => a !== 'record' && a !== '--output' && a !== '--format' && a !== '--browser' &&
        (outIdx === -1 || a !== argv[outIdx + 1]) &&
        (formatIdx === -1 || a !== argv[formatIdx + 1]) &&
        (browserIdx === -1 || a !== argv[browserIdx + 1])
    );
    const urlArg = recordArgv.find((a) => !a.startsWith('-') && (a.startsWith('http') || a.startsWith('file') || a.startsWith('https')));
    const initialUrl = urlArg || undefined;

    let recordingExiting = false;
    const doStopAndExit = (exitCode: number) => {
      if (recordingExiting) return;
      recordingExiting = true;
      stopRecording();
      exportRecorded({ output, format });
      process.exit(exitCode);
    };
    const onExit = () => doStopAndExit(0);
    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);

    const unhandledRejection = (reason: unknown) => {
      console.error('Recording error (unhandled rejection):', reason);
      stopRecording();
      process.exit(1);
    };
    process.on('unhandledRejection', unhandledRejection);

    try {
      await startRecording(initialUrl, {
        onBrowserClose: () => doStopAndExit(0),
        browser,
      });
    } catch (err) {
      console.error('Recording failed:', err instanceof Error ? err.message : err);
      if (err instanceof Error && err.stack) console.error(err.stack);
      stopRecording();
      process.exit(1);
    }
    return;
  }

  const cwd = process.cwd();

  if (argv.includes('run')) {
    const runIdx = argv.indexOf('run');
    const configPath = argv[runIdx + 1];
    if (!configPath) {
      console.error(
        'Usage: cstesting run <config.conf> [--headed] [--browser chrome|edge|opera|firefox] [--pause-on-failure|--debug]'
      );
      process.exit(1);
    }
    const headed = argv.includes('--headed');
    const pauseOnFailure = argv.includes('--pause-on-failure') || argv.includes('--debug');
    const browserIdx = argv.indexOf('--browser');
    let browser: 'chrome' | 'edge' | 'opera' | 'firefox' | undefined;
    if (browserIdx !== -1 && argv[browserIdx + 1]) {
      const b = String(argv[browserIdx + 1]).toLowerCase();
      if (b === 'edge' || b === 'opera' || b === 'firefox') browser = b;
      else if (b === 'chrome') browser = 'chrome';
    }
    await runConfig(configPath, { headless: !headed, browser, pauseOnFailure });
    return;
  }

  const { tags, excludeTags, pattern: tagPattern } = parseTagArgs();
  const arg = tagPattern ?? firstPatternArg();

  // cstesting login.conf  → run config file if extension is .conf or .config
  if (arg) {
    const ext = path.extname(arg).toLowerCase();
    if (ext === '.conf' || ext === '.config') {
      const configResolved = resolveConfigPath(arg);
      if (configResolved) {
        const headed = argv.includes('--headed');
        const pauseOnFailure = argv.includes('--pause-on-failure') || argv.includes('--debug');
        const browserIdx = argv.indexOf('--browser');
        let browser: 'chrome' | 'edge' | 'opera' | 'firefox' | undefined;
        if (browserIdx !== -1 && argv[browserIdx + 1]) {
          const b = String(argv[browserIdx + 1]).toLowerCase();
          if (b === 'edge' || b === 'opera' || b === 'firefox') browser = b;
          else if (b === 'chrome') browser = 'chrome';
        }
        await runConfig(arg, { headless: !headed, browser, pauseOnFailure });
        return;
      }
    }
  }

  const pattern = arg || defaultPattern;
  const resolved = path.resolve(cwd, pattern);
  let testFiles: string[];
  if (pattern.includes('*') || pattern.endsWith('.js') || pattern.endsWith('.ts')) {
    testFiles = findTestFiles(pattern, cwd);
  } else if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    testFiles = findTestFiles(pattern, cwd);
  } else if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    testFiles = [resolved];
  } else {
    testFiles = findTestFiles(pattern, cwd);
  }

  if (testFiles.length === 0) {
    console.log('No test files found. Create files matching *.test.js, *.test.ts, *.spec.js, or *.spec.ts — or run: cstesting path/to/test.js');
    process.exit(0);
    return;
  }

  if (tags.length > 0) {
    console.log(`Running tests with any tag: ${tags.join(', ')}\n`);
  }
  if (excludeTags.length > 0) {
    console.log(`Skipping tests with any tag: ${excludeTags.join(', ')}\n`);
  }

  const pauseOnFailure = argv.includes('--pause-on-failure') || argv.includes('--debug');

  const totalResult: RunResult = {
    passed: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    duration: 0,
    errors: [],
    passedTests: [],
    skippedTests: [],
  };

  for (const file of testFiles) {
    resetRunner();
    try {
      loadTestFile(file);
    } catch (err) {
      console.error(`Failed to load ${file}:`, err);
      process.exit(1);
    }
    const rel = path.relative(cwd, file);
    const result = await run({
      file: rel,
      pauseOnFailure,
      ...(tags.length > 0 ? { tags } : {}),
      ...(excludeTags.length > 0 ? { excludeTags } : {}),
    });
    totalResult.passed += result.passed;
    totalResult.failed += result.failed;
    totalResult.skipped += result.skipped;
    totalResult.total += result.total;
    totalResult.duration += result.duration;
    totalResult.errors.push(...result.errors);
    totalResult.passedTests.push(...result.passedTests);
    totalResult.skippedTests.push(...result.skippedTests);

    console.log(`\n ${rel}`);
    if (result.errors.length > 0) {
      for (const { suite, test, error } of result.errors) {
        console.log(`  ✗ ${suite} > ${test}`);
        console.log(formatError(error).split('\n').map((l) => `    ${l}`).join('\n'));
      }
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`  Passed: ${totalResult.passed}  Failed: ${totalResult.failed}  Skipped: ${totalResult.skipped}  Total: ${totalResult.total}  (${totalResult.duration}ms)`);

  const reportPath = writeReport(totalResult, { cwd, reportDir: 'report', filename: 'report.html' });
  console.log(`  Report: ${reportPath}`);

  if (totalResult.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
