# create-cstesting

Bootstrap a [CSTesting](https://www.npmjs.com/package/cstesting) project with an interactive wizard (same idea as `npm init playwright@latest`).

## Usage

In an empty folder or existing Node.js project:

```bash
npm init cstesting@latest
```

Or:

```bash
npm create cstesting@latest
```

You will be asked:

1. **TypeScript or JavaScript** (default: TypeScript)
2. **Tests folder** (default: `tests`, or `e2e` if `tests` already exists)
3. **GitHub Actions workflow** for CI (default: yes)
4. **Verify Chrome** is installed for browser tests (default: yes)

Then it creates sample tests, updates `package.json`, runs `npm install`, and prints how to run tests.

## Alternative

If `cstesting` is already installed:

```bash
npx cstesting init
```
