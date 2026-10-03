// Generate bundled notices from pnpm's production license report and Cargo metadata.
// pnpm licenses list --prod --json > /tmp/skritch-js-licenses.json
// cargo metadata --locked --format-version 1 --filter-platform x86_64-apple-darwin \
//   --manifest-path apps/desktop/src-tauri/Cargo.toml > /tmp/skritch-rust-metadata.json
// node scripts/collect-licenses.mjs <pnpm-report.json> <cargo-metadata.json>
import fs from 'node:fs';
import path from 'node:path';
const [jsFile, rustFile, outputFile = 'apps/desktop/src-tauri/resources/licenses/DEPENDENCIES.txt'] =
  process.argv.slice(2);
if (!jsFile || !rustFile) throw new Error('Pass pnpm license report and Cargo metadata paths');
const js = JSON.parse(fs.readFileSync(jsFile, 'utf8'));
const rust = JSON.parse(fs.readFileSync(rustFile, 'utf8'));
const packages = [
  ...Object.values(js)
    .flat()
    .map((p) => ({ name: p.name, version: p.versions.join(', '), license: p.license, root: p.paths[0] })),
  ...rust.packages
    .filter((p) => p.source)
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license,
      root: path.dirname(p.manifest_path),
    })),
];
const sections = [
  'Third-party software notices for Skritch\nGenerated from installed package metadata. Upstream license terms apply to their respective components.\nFFmpeg, libvpx and Opus notices are provided as separate files in this directory.',
];
for (const p of packages.sort((a, b) => a.name.localeCompare(b.name))) {
  const files = [];
  for (const sub of ['', 'licenses', 'LICENSES']) {
    const dir = path.join(p.root, sub);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      const f = path.join(dir, name);
      if (fs.statSync(f).isFile() && (sub || /^(licen[cs]e|copying|notice)([.\-_]|$)/i.test(name)))
        files.push(f);
    }
  }
  sections.push(
    `\n${'='.repeat(72)}\n${p.name} ${p.version}\nDeclared license: ${p.license || 'See upstream'}\n` +
      files.map((f) => `\n--- ${path.basename(f)} ---\n${fs.readFileSync(f, 'utf8')}`).join('\n'),
  );
}
fs.writeFileSync(outputFile, sections.join('\n'));
console.log(`Collected notices for ${packages.length} packages.`);
