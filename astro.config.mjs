import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import vercel from '@astrojs/vercel';

import mdx from '@astrojs/mdx';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
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

  integrations: [mdx(), sitemap()]
});