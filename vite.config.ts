import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * §13.8 LCP: the three font faces used by the first paint (body 400/500,
 * display 800) are requested by the CSS only after the shell JS renders,
 * which pushed first-load LCP past 3 s under slow 4G. The woff2 filenames
 * are content-hashed, so this plugin injects preload links for the exact
 * emitted files into index.html at bundle time. No other faces are
 * preloaded; the rest load on demand as before.
 *
 * It also modulepreloads the entry-route chunk (OnboardingScreen): every
 * first visit starts there, and the lazy round-trip delayed first paint by
 * ~400 ms under throttling. The route stays code-split; only its fetch
 * starts with the shell instead of after it.
 */
function fontPreloadPlugin(): Plugin {
  const WANTED = [
    'ibm-plex-sans-latin-400-normal',
    'ibm-plex-sans-latin-500-normal',
    'shippori-mincho-b1-latin-800-normal',
  ];
  return {
    name: 'zanshin-font-preload',
    // Post: index.html is emitted by Vite's own generateBundle step, so
    // this must run after it (otherwise bundle['index.html'] is absent).
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') return;
      const links: string[] = [];
      for (const fileName of Object.keys(bundle)) {
        if (fileName.endsWith('.woff2')) {
          if (WANTED.some((wanted) => fileName.includes(wanted))) {
            links.push(
              `<link rel="preload" href="/${fileName}" as="font" type="font/woff2" crossorigin>`,
            );
          }
        }
        if (/OnboardingScreen-[A-Za-z0-9_-]+\.js$/.test(fileName)) {
          links.push(`<link rel="modulepreload" crossorigin href="/${fileName}">`);
        }
      }
      if (links.length > 0) {
        html.source = String(html.source).replace(
          '</head>',
          `${links.join('\n    ')}\n  </head>`,
        );
      }
    },
  };
}

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 220,
    rollupOptions: {
      output: {
        // Oct 30 2026 fix: hash-bucketing EVERY module broke the app at
        // runtime — it split lodash (via recharts) across chunks with a
        // circular import, so a CJS module object was undefined at init
        // ("Cannot read properties of undefined (reading 'exports')") and
        // the app rendered blank. Reverted to the gated library grouping,
        // which passed the full e2e suite; only the moves JSON parts keep
        // their own chunks (plain data, no code, no cycles). Netlify has
        // no per-file upload limit, so the Vercel 90 kB chunk cap no
        // longer applies to this deployment.
        manualChunks: (id: string) => {
          if (id.includes('moves.yoshimitsu.1.json')) return 'moves-a';
          if (id.includes('moves.yoshimitsu.2.json')) return 'moves-b';
          if (id.includes('moves.yoshimitsu.3.json')) return 'moves-c';
          if (id.includes('node_modules/recharts')) return 'charts';
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
          if (id.includes('node_modules/react-router-dom')) return 'router';
          if (id.includes('node_modules/dexie') || id.includes('node_modules/zod') || id.includes('node_modules/zustand')) return 'data';
          return undefined;
        },
      },
    },
    sourcemap: false,
  },
  plugins: [
    react(),
    fontPreloadPlugin(),
    VitePWA({
      injectRegister: null, // manual registration in main.tsx (Safe Mode skips it)
      // The site sits behind a sign-in (a private Netlify project). Browsers
      // fetch the web app manifest without cookies unless the link carries
      // crossorigin="use-credentials"; without it the manifest request gets
      // the sign-in page instead and the browser will not install the app.
      useCredentials: true,
      manifest: {
        background_color: '#0E0F11',
        description: 'Personal Tekken 8 Yoshimitsu coaching app. Unofficial personal training tool.',
        display: 'standalone',
        icons: [
          { purpose: 'any', sizes: '192x192', src: 'icons/app-192.png', type: 'image/png' },
          { purpose: 'any', sizes: '512x512', src: 'icons/app-512.png', type: 'image/png' },
          { purpose: 'maskable', sizes: '512x512', src: 'icons/maskable-512.png', type: 'image/png' },
        ],
        name: 'ZANSHIN',
        short_name: 'ZANSHIN',
        start_url: '/',
        theme_color: '#0E0F11',
      },
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,json}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            handler: 'NetworkFirst',
            options: { cacheName: 'zanshin-api', networkTimeoutSeconds: 5 },
            urlPattern: /^https:\/\/wavu\.wiki\/w\/api\.php/,
          },
        ],
      },
    }),
  ],
  server: { port: 5173 },
});
