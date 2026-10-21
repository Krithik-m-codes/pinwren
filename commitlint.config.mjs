// Conventional Commits (https://www.conventionalcommits.org). release-please reads these to version
// packages and write the changelog, so the commit-msg hook and the PR-title check enforce them.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Bodies often quote paths, URLs and error output; wrapping those helps nobody.
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
