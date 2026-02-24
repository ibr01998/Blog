import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

import mdx from '@astrojs/mdx';


import db from '@astrojs/db';

// https://astro.build/config
// Force reload for DB schema update (visitorId)
export default defineConfig({
  output: 'server',

  vite: {
    plugins: [tailwindcss()],
    build: {
      // Optimize chunk size
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            // Separate vendor chunks for better caching
            'astro-remote': ['astro-remote'],
          }
        }
      }
    },
    // Optimize dependency pre-bundling
    optimizeDeps: {
      include: ['astro-remote']
    }
  },

  site: 'https://shortnews.tech',

  adapter: vercel({
    webAnalytics: {
      enabled: true,
    },
    // Enable edge functions for faster cold starts
    edgeMiddleware: false, // Keep false for Node.js compatibility with DB
    // Max duration for API routes (free tier max is 10s)
    functionPerRoute: false, // Share context between routes for better cold start
  }),

  integrations: [mdx(), db()]
});