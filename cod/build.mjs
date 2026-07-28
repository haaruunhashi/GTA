// Bundles the game into cod/build/bundle.js. Usage: node cod/build.mjs [--watch]
import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const opts = {
  entryPoints: [path.join(here, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['chrome120'],
  outfile: path.join(here, 'build/bundle.js'),
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
} else {
  await esbuild.build(opts);
}
