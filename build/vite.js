import { existsSync } from 'node:fs';
import { rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { applicationHtmlPlugin } from './application-html.js';
import cesium from 'vite-plugin-cesium';

/** Build browser assets with explicit inputs; never load environment or providers. */
export function createBrowserViteConfig({
  plugins = [],
  publicDir,
  googleApiKey,
  cesiumToken,
  host = 'localhost',
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
    ...(command === 'build' ? { cacheDir: 'node_modules/.vite-build' } : {}),
    optimizeDeps: {
      // First reached through the SDR worker or a dynamic import. Pre-bundle
      // them at startup so first use cannot invalidate already-transformed
      // URLs with Vite's "Outdated Optimize Dep" 504 response.
      include: [
        '@jtarrio/signals/demod/demodulator.js',
        '@jtarrio/signals/demod/modes.js',
        '@jtarrio/webrtlsdr/rtlsdr.js',
        'egm96-universal',
      ],
    },
    server: {
      host: host || 'localhost',
      port: parseInt(port, 10) || 4173,
      allowedHosts:
        host === '0.0.0.0' || host === '::'
          ? true
          : ['localhost', '127.0.0.1', '.local'],
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/ENVIRONMENT'],
      },
      // These headers protect the document containing Provider Settings.
      headers: {
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
      },
    },
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(googleApiKey),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(cesiumToken),
    },
    build: { chunkSizeWarningLimit: 1500 },
  };
}
