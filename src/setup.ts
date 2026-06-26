/**
 * Interactive setup — delegates to Playwright-style init wizard.
 */

import { runInitProject } from './init-project';

export { getTemplatesDir } from './init-project';

/** @deprecated Use getInitProjectRoot() — init always uses process.cwd(). */
export function getProjectRoot(): string {
  return process.cwd();
}

/** Run interactive setup (alias for init wizard). */
export async function runSetup(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.log(
      'CSTesting installed. Run "npm create cstesting@latest" or "npx cstesting init" in your project folder.'
    );
    return;
  }
  await runInitProject();
}

export { runInitProject };
