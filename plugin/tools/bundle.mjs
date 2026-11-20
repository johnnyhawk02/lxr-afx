// Gathers what the plugin carries, from the web app as it is in this repo (nothing is ported by hand):
//   build/dsp.js   the DSP: plugin/js/dsp-entry.js + sound/ + engine/, bundled into one plain script for JavaScriptCore
//   build/web/     the page: index.html, app/, css/, engine/, sound/, vendor/ as they are, plus the fonts (fetched once
//                  here, so the plugin looks right without a network) and plugin/js/shim.js
// The CMake build zips build/web into the plugin. Run: node plugin/tools/bundle.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const plugin = path.resolve(here, '..'), repo = path.resolve(plugin, '..'), out = path.join(plugin, 'build');
fs.mkdirSync(out, { recursive: true });

// the page's imports carry ?v= cache stamps (tools/stamp.mjs): the same file either way
const noStamp = { name: 'no-stamp', setup(b) {
  b.onResolve({ filter: /\?v=/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?.*$/, '')) }));
} };
await build({ entryPoints: [path.join(plugin, 'js/dsp-entry.js')], bundle: true, format: 'iife', target: 'es2020',
  outfile: path.join(out, 'dsp.js'), plugins: [noStamp], legalComments: 'inline', logLevel: 'warning' });

const web = path.join(out, 'web');
fs.rmSync(web, { recursive: true, force: true });
for (const d of ['app', 'css', 'engine', 'sound', 'vendor']) fs.cpSync(path.join(repo, d), path.join(web, d), { recursive: true });
let html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');

// the fonts: Google's stylesheet, with its font files, kept here
const FONTS = html.match(/https:\/\/fonts\.googleapis\.com\/css2\?[^"]+/);
if (FONTS && !process.env.LXR_NO_FONTS) {
  try {
    const ua = { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' } };
    let css = await (await fetch(FONTS[0].replace(/&amp;/g, '&'), ua)).text();
    fs.mkdirSync(path.join(web, 'fonts'), { recursive: true });
    let i = 0;
    for (const u of [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) || [])]) {
      const name = `f${i++}${path.extname(new URL(u).pathname) || '.woff2'}`;
      fs.writeFileSync(path.join(web, 'fonts', name), Buffer.from(await (await fetch(u)).arrayBuffer()));
      css = css.split(u).join(name);
    }
    fs.writeFileSync(path.join(web, 'fonts', 'fonts.css'), css);
    html = html.replace(FONTS[0], 'fonts/fonts.css').replace(/<link rel="preconnect"[^>]*>\n?/g, '');
    console.log(`fonts: ${i} files kept`);
  } catch (e) { console.warn('fonts not fetched (the plugin will load them from Google):', e.message); }
}
fs.writeFileSync(path.join(web, 'index.html'), html);
const n = (d) => fs.readdirSync(d, { recursive: true }).length;
console.log(`dsp.js ${(fs.statSync(path.join(out, 'dsp.js')).size / 1024).toFixed(0)} KB, web/ ${n(web)} files`);
