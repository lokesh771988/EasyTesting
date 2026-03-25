/**
 * Run a config file: parse steps, execute in browser, return RunResult for report.
 */

import type { RunResult } from './types';
import { waitForEnter } from './wait-for-enter';
import type { ParsedConfig, ConfigStep } from './config-parser';
import { parseConfigFile } from './config-parser';
import { createBrowser, resolveSelector, type BrowserType } from './browser';
import type { BrowserApi, FrameHandle, LocatorApi } from './browser';
import { compareScreenshots } from './visual-compare';
import { checkOverlappingText, checkHiddenOrOverlappingText } from './text-layout-check';

function stepLabel(step: ConfigStep): string {
  switch (step.action) {
    case 'goto':
      return `goto ${step.url}`;
    case 'type':
      return `type ${step.label}`;
    case 'click':
      return `click ${step.locator}`;
    case 'wait':
      return `wait ${step.ms}ms`;
    case 'screenshot':
      return `getScreenshot ${step.path}${step.fullPage ? ' fullPage' : ''}${step.element ? ' element=' + step.element : ''}`;
    case 'doubleClick':
      return `doubleClick ${step.locator}`;
    case 'rightClick':
      return `rightClick ${step.locator}`;
    case 'hover':
      return `hover ${step.locator}`;
    case 'dragAndDrop':
      return `dragAndDrop ${(step as { sourceLocator: string }).sourceLocator} → ${step.locator}`;
    case 'switchTab':
      return `switchTab ${step.index}`;
    case 'frame':
      return `frame ${step.selector}`;
    case 'check':
      return `check ${step.locator}`;
    case 'uncheck':
      return `uncheck ${step.locator}`;
    case 'select':
      return `select ${step.locator}`;
    case 'dialog':
      return step.behavior === 'dismiss' ? 'dialog dismiss' : step.promptText != null ? `dialog prompt:${step.promptText}` : 'dialog accept';
    case 'close':
      return 'close browser';
    case 'verifyText':
      if (!step.selector) return `assertText page contains "${step.expected}"`;
      return step.index !== undefined
        ? `assertText ${step.selector}[${step.index}] contains "${step.expected}"`
        : `assertText ${step.selector} contains "${step.expected}"`;
    case 'assertTextEqualsAttribute':
      return `assertText ${step.textSelector} equals attr ${step.attributeName} of ${step.attrSelector}`;
    case 'assertAttribute':
      return `assertAttribute ${step.selector} attr ${step.attributeName} = "${step.expected}"`;
    case 'assertScreenshot':
      const ss = step as { baselinePath: string; threshold?: number; resize?: boolean };
      return `assertScreenshot ${ss.baselinePath}${ss.resize ? ' (resize)' : ''}`;
    case 'assertNoOverlappingText':
      return 'assertNoOverlappingText (Type 2)';
    case 'assertNoHiddenOrOverlappingText':
      return 'assertNoHiddenOrOverlappingText (Type 3)';
    case 'getText':
      return step.variable ? `getText ${step.selector} → $${step.variable}` : `getText ${step.selector} → $lastText`;
    case 'display':
      return step.isVariable ? `display $${step.selectorOrVariable}` : `display ${step.selectorOrVariable}`;
    case 'assertVar':
      return `assertVar $${step.variable} = "${step.expected}"`;
    case 'forEach':
      return `forEach ${step.selector} (${step.body.length} steps)`;
    case 'if':
      return step.varName != null ? `if $${step.varName} = "${step.expected}"` : `if ${step.selector} = "${step.expected}"`;
    default:
      return String(step);
  }
}

/** Common interface for browser or frame (click, type, etc.). */
type PageLike = Pick<
  BrowserApi,
  'click' | 'type' | 'doubleClick' | 'rightClick' | 'hover' | 'dragAndDrop' | 'check' | 'uncheck' | 'select' | 'waitForSelector'
>;

/** Escape for use inside a JS expression string. */
function escapeForEval(s: string): string {
  return JSON.stringify(s);
}

/**
 * Fill input via DOM: focus, set value, fire input/change.
 * Uses same resolveSelector as browser. Targets input when selector is [name="x"].
 */
async function fillInputByDom(browser: BrowserApi, selector: string, value: string): Promise<void> {
  const resolved = resolveSelector(selector);
  const inputSelector =
    resolved.startsWith('[name="') && resolved.endsWith('"]')
      ? 'input' + resolved
      : resolved;
  const sel = escapeForEval(inputSelector);
  const val = escapeForEval(value);
  const expr = `(function(){
    var selector = ${sel};
    var value = ${val};
    var el = document.querySelector(selector);
    if (!el) throw new Error('Element not found: ' + selector);
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus();
    el.select && el.select();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('keyup', { bubbles: true }));
    return true;
  })()`;
  await browser.evaluate(expr);
}

/** How to handle the next JavaScript dialog (alert/confirm/prompt). */
export type PendingDialog = { accept: boolean; promptText?: string } | null;

/** Context for steps that can run in main page or inside a frame. */
interface RunContext {
  getBrowser: () => BrowserApi | null;
  currentFrame: FrameHandle | null;
  setNextDialog: (d: PendingDialog) => void;
  onClose: () => void;
  variables: Record<string, string>;
  /** When inside forEach, locator for the current element (row/cell/option). Use >>selector for same-row. */
  currentLoopLocator: LocatorApi | null;
}

function getTarget(ctx: RunContext): PageLike {
  const browser = ctx.getBrowser();
  return (ctx.currentFrame ?? browser) as PageLike;
}

/** Resolve selector: >> means current loop element; >>sel means within current loop element; else page/frame. */
function getLocator(ctx: RunContext, selector: string): LocatorApi {
  const base = ctx.currentFrame ?? ctx.getBrowser()!;
  if (ctx.currentLoopLocator && selector.startsWith('>>')) {
    const inner = selector.slice(2).trim();
    return inner ? ctx.currentLoopLocator.locator(inner) : ctx.currentLoopLocator;
  }
  return base.locator(selector);
}

/** Get number of elements matching selector (for forEach). */
async function getSelectorCount(ctx: RunContext, selector: string): Promise<number> {
  const base = ctx.currentFrame ?? ctx.getBrowser()!;
  const isXPath = selector.startsWith('/') || selector.startsWith('(');
  const sel = JSON.stringify(selector);
  const expr = isXPath
    ? `(function(s){ try { var r = document.evaluate("count(" + s + ")", document, null, XPathResult.NUMBER_TYPE, null); return r.numberValue; } catch(e) { return 0; } })(${sel})`
    : `(function(s){ try { return document.querySelectorAll(s).length; } catch(e) { return 0; } })(${sel})`;
  return base.evaluate<number>(expr);
}

/** Run a list of steps (used for forEach body and if body). */
async function runSteps(ctx: RunContext, steps: ConfigStep[]): Promise<void> {
  for (const s of steps) await executeStep(ctx, s);
}

async function executeStep(ctx: RunContext, step: ConfigStep): Promise<void> {
  const browser = ctx.getBrowser();
  if (!browser && step.action !== 'close') {
    throw new Error('Browser is closed. Start a new test case to continue.');
  }

  if (step.action === 'close') {
    if (!browser) throw new Error('Browser is already closed.');
    await browser.close();
    ctx.onClose();
    return;
  }

  const b = browser!;
  const target = getTarget(ctx);

  switch (step.action) {
    case 'goto': {
      await b.goto(step.url);
      try {
        await Promise.race([
          b.waitForLoad(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Load timeout')), 15000)),
        ]);
      } catch {
        // Page load timed out; continue anyway
      }
      await new Promise((r) => setTimeout(r, 800));
      return;
    }
    case 'wait': {
      await new Promise((r) => setTimeout(r, step.ms));
      return;
    }
    case 'dialog': {
      ctx.setNextDialog({
        accept: step.behavior === 'accept',
        promptText: step.promptText,
      });
      return;
    }
    case 'screenshot': {
      await b.getScreenshot({
        path: step.path,
        fullPage: step.fullPage,
        selector: step.element,
      });
      return;
    }
    case 'assertScreenshot': {
      const { baselinePath, threshold, resize } = step as { baselinePath: string; threshold?: number; resize?: boolean };
      const actualBuffer = await b.getScreenshot({ fullPage: true });
      const result = compareScreenshots(actualBuffer, baselinePath, {
        threshold,
        resizeMode: resize ? 'actualToBaseline' : 'strict',
      });
      if (result.dimensionMismatch) {
        throw new Error(
          `assertScreenshot: dimension mismatch. Baseline: ${result.dimensionMismatch.baseline.width}x${result.dimensionMismatch.baseline.height}, actual: ${result.dimensionMismatch.actual.width}x${result.dimensionMismatch.actual.height}. Add =resize to compare by resizing actual to baseline size.`
        );
      }
      if (!result.match) {
        throw new Error(
          `assertScreenshot: visual diff. ${result.diffPixelCount} pixels differ (${(result.diffRatio * 100).toFixed(2)}%). Baseline: ${baselinePath}.`
        );
      }
      return;
    }
    case 'assertNoOverlappingText': {
      const page = ctx.currentFrame ?? b;
      const result = await checkOverlappingText(page);
      if (result.overlapping.length > 0) {
        const msg = result.overlapping
          .slice(0, 3)
          .map((p) => `"${p.a.text}" vs "${p.b.text}"`)
          .join('; ');
        throw new Error(
          `assertNoOverlappingText (Type 2): ${result.overlapping.length} overlapping text pair(s) found. Examples: ${msg}.`
        );
      }
      return;
    }
    case 'assertNoHiddenOrOverlappingText': {
      const page = ctx.currentFrame ?? b;
      const result = await checkHiddenOrOverlappingText(page);
      const parts: string[] = [];
      if (result.hidden.length > 0) parts.push(`${result.hidden.length} hidden text`);
      if (result.overlapping.length > 0) parts.push(`${result.overlapping.length} overlapping pair(s)`);
      if (parts.length > 0) {
        const hiddenSample = result.hidden.slice(0, 2).map((h) => `"${h.text}" (${h.reason})`).join('; ');
        const overlapSample = result.overlapping.slice(0, 2).map((p) => `"${p.a.text}" vs "${p.b.text}"`).join('; ');
        throw new Error(
          `assertNoHiddenOrOverlappingText (Type 3): ${parts.join(', ')}. Hidden: ${hiddenSample}. Overlap: ${overlapSample}.`
        );
      }
      return;
    }
    case 'switchTab': {
      await b.switchToTab(step.index);
      await new Promise((r) => setTimeout(r, 300));
      return;
    }
    case 'frame': {
      const raw = step.selector.trim().toLowerCase();
      if (raw === 'main' || raw === '') {
        ctx.currentFrame = null;
        return;
      }
      const parts = step.selector.split(',').map((s) => s.trim()).filter(Boolean);
      let frame: FrameHandle = b.frame(parts[0]);
      for (let i = 1; i < parts.length; i++) {
        frame = frame.frame(parts[i]);
      }
      ctx.currentFrame = frame;
      return;
    }
    case 'type': {
      const typeLoc = getLocator(ctx, step.locator);
      await typeLoc.type(step.value);
      if (!ctx.currentFrame) {
        await Promise.race([
          b.waitForLoad(),
          new Promise<void>((r) => setTimeout(r, 2000)),
        ]).catch(() => {});
      }
      return;
    }
    case 'click': {
      await getLocator(ctx, step.locator).click();
      if (!ctx.currentFrame) {
        await Promise.race([
          b.waitForLoad(),
          new Promise<void>((r) => setTimeout(r, 2000)),
        ]).catch(() => {});
      }
      return;
    }
    case 'doubleClick': {
      await getLocator(ctx, step.locator).doubleClick();
      return;
    }
    case 'rightClick': {
      await getLocator(ctx, step.locator).rightClick();
      return;
    }
    case 'hover': {
      await getLocator(ctx, step.locator).hover();
      return;
    }
    case 'dragAndDrop': {
      const src = (step as { sourceLocator: string }).sourceLocator;
      await getLocator(ctx, src).dragTo(step.locator);
      return;
    }
    case 'check': {
      await getLocator(ctx, step.locator).check();
      return;
    }
    case 'uncheck': {
      await getLocator(ctx, step.locator).uncheck();
      return;
    }
    case 'select': {
      const opt = step.option.value != null ? { value: step.option.value } : { label: step.option.label! };
      await getLocator(ctx, step.locator).select(opt);
      return;
    }
    case 'verifyText': {
      let actual: string;
      if (step.selector) {
        let loc = getLocator(ctx, step.selector);
        if (step.index !== undefined) loc = loc.nth(step.index);
        actual = await loc.textContent();
        // Element: exact match (trimmed, case-insensitive) so checkbox input (empty) or "Wednesday" won't pass for "monday"
        const actualTrimmed = actual.trim();
        const expectedTrimmed = step.expected.trim();
        if (actualTrimmed.toLowerCase() !== expectedTrimmed.toLowerCase()) {
          const gotDisplay = actualTrimmed.length > 0 ? actualTrimmed.slice(0, 200) + (actualTrimmed.length > 200 ? '...' : '') : '(empty)';
          const hint = actualTrimmed.length === 0
            ? ' Input/checkbox elements have no text; use the label or parent that contains the text (e.g. (//label[input[@type="checkbox"]])[2] for the 2nd day label).'
            : '';
          throw new Error(
            `Text verification failed: expected "${expectedTrimmed}", but got: ${gotDisplay}.${hint}`
          );
        }
      } else {
        if (ctx.currentFrame) {
          actual = await ctx.currentFrame.evaluate<string>('document.body.innerText || ""');
        } else {
          actual = await b.evaluate<string>('document.body.innerText || ""');
        }
        // Page: contains (substring)
        if (!actual.includes(step.expected)) {
          throw new Error(
            `Text verification failed: page should contain "${step.expected}", but got: ${actual.slice(0, 200)}${actual.length > 200 ? '...' : ''}`
          );
        }
      }
      return;
    }
    case 'assertTextEqualsAttribute': {
      const attrLoc = getLocator(ctx, step.attrSelector);
      const textLoc = getLocator(ctx, step.textSelector);
      const attrValue = await attrLoc.getAttribute(step.attributeName);
      const textValue = await textLoc.textContent();
      const a = (attrValue ?? '').trim().toLowerCase();
      const t = (textValue ?? '').trim().toLowerCase();
      if (a !== t) {
        throw new Error(
          `assertTextEqualsAttribute failed: text of ${step.textSelector} ("${(textValue ?? '').trim()}") does not equal attr ${step.attributeName} of ${step.attrSelector} ("${(attrValue ?? '').trim()}")`
        );
      }
      return;
    }
    case 'assertAttribute': {
      const loc = getLocator(ctx, step.selector);
      const attrValue = await loc.getAttribute(step.attributeName);
      const actual = (attrValue ?? '').trim();
      const expectedTrimmed = step.expected.trim();
      if (actual.toLowerCase() !== expectedTrimmed.toLowerCase()) {
        throw new Error(
          `assertAttribute failed: ${step.selector} attr ${step.attributeName} expected "${expectedTrimmed}", got "${actual}"`
        );
      }
      return;
    }
    case 'getText': {
      const loc = getLocator(ctx, step.selector);
      const text = await loc.textContent();
      const stored = (text ?? '').trim();
      const varName = step.variable ?? 'lastText';
      ctx.variables[varName] = stored;
      return;
    }
    case 'display': {
      if (step.isVariable) {
        const val = ctx.variables[step.selectorOrVariable];
        console.log('      [display]', val !== undefined ? val : '(undefined)');
      } else {
        const loc = getLocator(ctx, step.selectorOrVariable);
        const text = await loc.textContent();
        console.log('      [display]', (text ?? '').trim());
      }
      return;
    }
    case 'assertVar': {
      const actual = ctx.variables[step.variable];
      const expectedTrimmed = step.expected.trim();
      if (actual === undefined) {
        throw new Error(`assertVar failed: variable $${step.variable} is not set. Use getText=selector=${step.variable} first.`);
      }
      if (actual.trim() !== expectedTrimmed) {
        throw new Error(`assertVar failed: $${step.variable} expected "${expectedTrimmed}", got "${actual}"`);
      }
      return;
    }
    case 'forEach': {
      const base = (ctx.currentFrame ?? b).locator(step.selector);
      const count = await getSelectorCount(ctx, step.selector);
      for (let i = 0; i < count; i++) {
        ctx.currentLoopLocator = base.nth(i);
        try {
          await runSteps(ctx, step.body);
        } finally {
          ctx.currentLoopLocator = null;
        }
      }
      return;
    }
    case 'if': {
      let conditionMet: boolean;
      if (step.varName != null) {
        const val = ctx.variables[step.varName];
        conditionMet = val !== undefined && val.trim() === step.expected.trim();
      } else {
        const loc = getLocator(ctx, step.selector!);
        const text = (await loc.textContent() ?? '').trim();
        conditionMet = text === step.expected.trim();
      }
      if (conditionMet) await runSteps(ctx, step.body);
      return;
    }
  }
}

export interface RunConfigResult extends RunResult {
  configName: string;
}

/**
 * Run a config file: open browser, execute each test case (each # section = one test).
 * Each test case is reported as one test with all its steps listed.
 */
export async function runConfigFile(
  configPath: string,
  options?: { headless?: boolean; browser?: BrowserType; pauseOnFailure?: boolean }
): Promise<RunConfigResult> {
  const parsed = parseConfigFile(configPath);
  const { name: configName, testCases, headless: configHeadless } = parsed;

  const result: RunConfigResult = {
    configName,
    passed: 0,
    failed: 0,
    skipped: 0,
    total: testCases.length,
    duration: 0,
    errors: [],
    passedTests: [],
    skippedTests: [],
  };

  if (testCases.length === 0) {
    return result;
  }

  const headless = options?.headless !== undefined ? options.headless : configHeadless;
  const start = Date.now();
  let browser: BrowserApi | null = null;
  let nextDialog: PendingDialog = null;

  try {
    console.log('  Browser will start when needed.\n');

    for (let tcIndex = 0; tcIndex < testCases.length; tcIndex++) {
      const { testCaseName, steps } = testCases[tcIndex];
      const stepLabels: string[] = [];
      const caseStart = Date.now();
      console.log('  Test case:', testCaseName);

      if (!browser) {
        const browserName = options?.browser || 'chrome';
        console.log('  Launching ' + browserName + ' (' + (headless ? 'headless' : 'visible window') + ')...');
        browser = await createBrowser({ headless, browser: browserName });
        browser.setDialogHandler(() => {
          const p = nextDialog;
          nextDialog = null;
          return p ?? { accept: true, promptText: '' };
        });
      }

      let failed = false;
      let lastError: Error | null = null;
      let failedStepIndex: number | undefined;
      const runCtx: RunContext = {
        getBrowser: () => browser,
        currentFrame: null,
        setNextDialog: (d) => {
          nextDialog = d;
        },
        onClose: () => {
          browser = null;
        },
        variables: {},
        currentLoopLocator: null,
      };
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const label = stepLabel(step);
        stepLabels.push(label);
        console.log('    Step', i + 1 + ':', label);
        try {
          await executeStep(runCtx, step);
          console.log('      OK');
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          failedStepIndex = i;
          console.error('      FAIL:', lastError.message);
          failed = true;
          // Add remaining step labels so the HTML report shows all steps (including not run)
          for (let j = i + 1; j < steps.length; j++) {
            stepLabels.push(stepLabel(steps[j]));
          }
          break;
        }
      }

      const duration = Date.now() - caseStart;
      if (failed && lastError) {
        result.failed++;
        result.errors.push({
          suite: configName,
          test: testCaseName,
          error: lastError,
          duration,
          steps: stepLabels,
          failedStepIndex,
          file: configName,
        });
        if (options?.pauseOnFailure) {
          if (process.stdin.isTTY) {
            await waitForEnter(
              '  Browser left open for debugging. Inspect the page, fix your .conf, then press Enter to close the browser.'
            );
          } else {
            console.log(
              '  (--pause-on-failure ignored: stdin is not a TTY; browser will close so CI does not hang.)'
            );
          }
          break;
        }
      } else {
        result.passed++;
        result.passedTests!.push({
          suite: configName,
          test: testCaseName,
          duration,
          steps: stepLabels,
          file: configName,
        });
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  result.duration = Date.now() - start;
  return result;
}

export { parseConfigFile };
export type { ParsedConfig, ConfigStep } from './config-parser';
