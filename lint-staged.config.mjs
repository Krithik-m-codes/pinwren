// Pre-commit checks. Windows caps a command line at ~32 KB, so a large commit (a rename, a formatting pass)
// lints the whole repo instead of passing every file name to ESLint.
const MAX_FILES = 40;
const quote = (files) => files.map((f) => JSON.stringify(f)).join(" ");

export default {
  "*.{js,mjs,cjs,ts,tsx,mts,cts}": (files) => [
    files.length > MAX_FILES
      ? "eslint . --max-warnings=0"
      : `eslint --max-warnings=0 --no-warn-ignored ${quote(files)}`,
    files.length > MAX_FILES ? "prettier --check ." : `prettier --write ${quote(files)}`,
  ],
  "*.{json,md,yml,yaml,css,html}": (files) =>
    files.length > MAX_FILES ? "prettier --check ." : `prettier --write ${quote(files)}`,
};
