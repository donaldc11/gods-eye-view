import { existsSync } from 'node:fs';
import { rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { applicationHtmlPlugin } from './application-html.js';
import cesium from 'vite-plugin-cesium';

/**
 * Configure Vite build and dev settings for the standalone application.
 * HTML defines, asset resolution, Cesium static copies, and server bindings.
 */
export function createBrowserViteConfig({
  publicDir,
  plugins = [],
  port = 4173,
  command,
} = {}) {
  let outputConfig;
  return {
    plugins: [cesium(), {
      name: 'cesium-subpath-output',
      apply: 'build',
      configResolved(config) { outputConfig = config; },
      closeBundle: {
        order: 'post',
        sequential: true,
        async handler() {
          // vite-plugin-cesium includes URL base in its disk path. The server
          // strips /app, so keep files at dist/cesium, not dist/app/cesium.
          const config = outputConfig;
          if (!config) return;
          const out = path.resolve(config.root, config.build.outDir);
          const prefix = config.base.replace(/^\/+|\/+$/g, '');
          if (!prefix || prefix.includes('..') || prefix.includes(':')) return;
          const nested = path.join(out, prefix, 'cesium');
          const target = path.join(out, 'cesium');
          if (existsSync(nested) && !existsSync(target)) {
            await mkdir(out, { recursive: true });
            await rename(nested, target);
          }
        },
      },
    }, applicationHtmlPlugin(), ...plugins],
    ...(publicDir === undefined ? {} : { publicDir }),
    // A production build must not clean the dependency cache a running dev
    // server is still serving optimized module URLs from.
    ...(command === 'build'
      ? { cacheDir: 'node_modules/.vite-browser-build' }
      : {}),
    server: {
      port,
      strictPort: true,
    },
  };
}
