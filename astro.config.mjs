import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

import mdx from '@astrojs/mdx';

import sitemap from '@astrojs/sitemap';

import db from '@astrojs/db';

// https://astro.build/config
// Force reload for DB schema update (visitorId)
export default defineConfig({
  output: 'server',

  vite: {
    plugins: [tailwindcss()]
  },

  site: 'https://shortnews.tech',

  adapter: vercel({
    webAnalytics: {
      enabled: true,
    },
  }),

  integrations: [mdx(), sitemap(), db()]
});