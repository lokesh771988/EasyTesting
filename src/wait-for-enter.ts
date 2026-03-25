/**
 * Block until the user presses Enter (for pause-on-failure debugging).
 */

import * as readline from 'node:readline';

export async function waitForEnter(message: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message + '\n', () => {
      rl.close();
      resolve();
    });
  });
}
