# Optional GitHub Actions workflows

These are ready-to-enable workflow templates. They are stored outside `.github/workflows/` because
the publishing GitHub OAuth token has repository access but does not have the `workflow` scope.
The public download site currently uses the `gh-pages` branch and GitHub's built-in Pages publishing.

To enable Actions later, authorize GitHub CLI with `gh auth refresh -h github.com -s workflow`, then
copy the desired templates into `.github/workflows/` and push:

- `windows.yml`: builds LGPL Windows sidecars on Linux, then runs TypeScript, unit/browser/native
  tests and packages Windows x64 EXE/MSI/portable ZIP artifacts with corresponding sources and checksums.
- `macos.yml`: universal Mac CI build with LGPL sidecars. CI uses ad-hoc signing; public releases
  should use Developer ID signing as described in the root README.
- `pages.yml`: optional Actions-based deployment of `site/`. Switch Pages source from branch-based
  publishing to GitHub Actions before enabling this template.

The native build workflows can be expensive on first run because they build the video sidecars.
