import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Version label: "v.<first 4 chars of the deployed commit>".
// Cloudflare Workers Builds exposes WORKERS_CI_COMMIT_SHA; locally we ask git.
function commitSha() {
  const fromEnv = process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA;
  if (fromEnv) return fromEnv;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '0000';
  }
}

const VERSION = 'v.' + commitSha().slice(0, 4);

// Stage-1 models are fetched in parallel with the JS bundle via <link rel=preload>.
const PRELOAD_ASSETS = /assets\/ships-[\w-]+\.glb$/;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(VERSION),
  },
  plugins: [
    {
      name: 'pilot-one-html',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          html = html.replaceAll('%APP_VERSION%', VERSION);
          if (!ctx.bundle) return html;
          const tags = [];
          for (const file of Object.values(ctx.bundle)) {
            if (file.type === 'asset' && PRELOAD_ASSETS.test(file.fileName)) {
              tags.push({
                tag: 'link',
                attrs: { rel: 'preload', href: '/' + file.fileName, as: 'fetch', crossorigin: '' },
                injectTo: 'head',
              });
            }
          }
          return { html, tags };
        },
      },
    },
  ],
  assetsInclude: ['**/*.glb'],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
  },
  server: { host: true },
});
