import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

// `pixi.js` resolves to this fork's compiled `lib/` (run `npm run build:lib` or `npm run watch:lib`
// at the repo root first), so changes to the PixiJS source show up here without publishing.
export default defineConfig({
    resolve: {
        alias: [
            // `pixi.js/events` etc. are the side-effect entry points (`lib/<name>/init.mjs`)
            { find: /^pixi\.js\/(.+)$/, replacement: `${resolve(repoRoot, 'lib')}/$1/init.mjs` },
            { find: /^pixi\.js$/, replacement: resolve(repoRoot, 'lib/index.mjs') },
        ],
    },
    // Pre-bundling would give @pixi/3d its own copy of pixi.js; it must share the one aliased above.
    optimizeDeps: {
        exclude: ['@pixi/3d'],
    },
    worker: {
        format: 'es',
    },
    server: {
        fs: { allow: [repoRoot] },
    },
});
