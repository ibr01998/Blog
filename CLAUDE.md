# ShortNews Blog - Claude Code Project Documentation

## Project Overview

**ShortNews.tech** is an autonomous AI-powered crypto trading blog platform built with Astro, featuring a sophisticated 6-agent editorial system for content generation, dual content storage, comprehensive analytics, and affiliate monetization.

**Tech Stack:**
- **Framework**: Astro 5.17.1 (SSR mode with Vercel adapter)
- **Language**: TypeScript 5.9.3 (strict mode)
- **Styling**: Tailwind CSS 4.1.18 (via Vite plugin) + custom design system
- **AI/ML**: Vercel AI SDK + Anthropic Claude + OpenAI + Google Gemini
- **Databases**: Astro DB (Turso SQLite) + Neon Postgres
- **Deployment**: Vercel (with cron jobs, analytics, speed insights)

---

## Architecture Overview

### Content Sources (Dual System)

The blog supports two independent content sources that work together seamlessly:

#### 1. File-Based Content Collections
- **Location**: `/src/content/blog/`
- **Format**: Markdown/MDX files with Zod-validated frontmatter
- **Schema**: Defined in `/src/content.config.ts`
- **Use Case**: Hand-crafted articles, editorial pieces
- **Access**: Via Astro's `getCollection('blog')` API

#### 2. Database Posts (AI-Generated)
- **Primary Storage**: Astro DB (Turso SQLite) - Table: `Post`
  - Used for: Fast page rendering, RSS/sitemap generation
  - Contains: Full MDX body, metadata, JSON fields (platforms, blocks)
- **Agent Storage**: Postgres (Neon) - Tables: `agents`, `articles`, `agent_logs`, `article_metrics`
  - Used for: AI orchestration, embeddings, analytics, evolution
  - Contains: Detailed agent configs, execution logs, performance data

**Rendering Flow** (`/blog/[...slug].astro`):
1. Check Astro DB `Post` table by slug
2. If found and published → render with `astro-remote` Markdown component
3. Else fallback to Content Collection
4. Load related platforms and display sidebar with CTAs

---

## AI Agent System

### 6-Agent Editorial Cycle

**Orchestrator**: `/src/lib/orchestrator.ts` - `runEditorialCycle()`

**Agent Pipeline:**
1. **Analyst** (`analyst.ts`) - Analyzes market trends, past performance → AnalystReport
2. **Strategist** (`strategist.ts`) - Generates 10 article briefs from report
3. **Editor** (`editor.ts`) - Selects max 3 briefs for production → ArticleAssignments
4. **Writer** (`writer.ts`) - Generates full article draft from brief
5. **Humanizer** (`humanizer.ts`) - Improves readability, reduces AI tone
6. **SEO** (`seo.ts`) - Optimizes keywords, meta descriptions, internal links

**Execution Triggers:**
- **Cron Jobs** (vercel.json):
  - Research: Daily at 2 AM (`/api/admin/run-research`)
  - Full Cycle: Mon/Thu at 8 AM (`/api/admin/run-cycle`)
- **Manual**: Dashboard `/dashboard/ai-articles` → "Run Editorial Cycle" button
- **API**: POST `/api/admin/run-cycle` (protected by middleware + cron secret)

**Progress Tracking:**
- Supports Server-Sent Events (SSE) for real-time dashboard updates
- Callback function for logging each stage
- All agent reasoning logged to Postgres `agent_logs` table

### Agent Configuration

**Base Class**: `/src/lib/agents/base.ts` - `BaseAgent`
- Loads agent config from Postgres `agents` table
- Merges `personality_config` + `behavior_overrides`
- Resolves model strings: `"anthropic:claude-3-5-sonnet"`, `"openai:gpt-4o-mini"`
- Uses Vercel AI SDK (`generateText`, `generateObject`)
- Structured output via Zod schemas

**Model Providers:**
- Anthropic: Claude 3.5 Sonnet (primary for complex reasoning)
- OpenAI: GPT-4o Mini (cost-effective fallback)
- Google: Gemini Flash (experimental)

**Customization:**
- Each agent has unique `personality_config` (tone, style, priorities)
- `behavior_overrides` can be set per agent for A/B testing
- Performance metrics feed back into evolution system

### Embeddings System

**Implementation**: `/src/lib/embeddings.ts`
- **Model**: OpenAI `text-embedding-3-small` (1536 dimensions)
- **Storage**: Postgres `articles` table with `embedding` column (vector type)
- **Usage**: Semantic similarity for related articles, content recommendations
- **Generated**: During article creation, stored alongside metadata

---

## Database Schema

### Astro DB (Turso SQLite) - `/db/config.ts`

**Post Table:**
```typescript
{
  slug: text (PK),
  title: text,
  description: text,
  body: text,              // Full MDX content
  pubDate: date,
  updatedDate: date (optional),
  heroImage: text,
  target_keyword: text,
  seo_title: text,
  article_type: text,
  platforms: text,         // JSON array
  blocks: text,            // JSON array (CTA blocks)
  status: text             // 'published' | 'draft'
}
```

**Platform Table:**
- Crypto exchange data: features, fees, pros/cons, affiliate links

**Analytics Tables:**
- `AnalyticsView`: Page views, duration, visitor tracking
- `AnalyticsClick`: Affiliate click tracking

### Postgres (Neon) - `/src/lib/db/postgres.ts`

**Agent System Tables:**
- `agents`: Agent configurations (personality, model, performance)
- `articles`: Master article data with embedding vectors
- `agent_logs`: Execution logs from each cycle stage
- `system_config`: Global settings (pause status, quotas, evolution)

**Analytics Tables:**
- `article_metrics`: CTR, time-on-page, conversion rate per article
- `affiliate_links`: Tracking data for platform links

---

## Project Structure

```
/Users/ai/Documents/Blog/
├── src/
│   ├── pages/                    # All routes (Astro file-based routing)
│   │   ├── blog/
│   │   │   ├── [...slug].astro  # Dynamic blog post viewer
│   │   │   └── index.astro      # Blog listing with search/filters
│   │   ├── dashboard/           # Protected admin interface
│   │   │   ├── login.astro
│   │   │   ├── ai-articles.astro
│   │   │   ├── agents.astro
│   │   │   ├── analytics.astro
│   │   │   ├── system.astro
│   │   │   └── ...
│   │   ├── api/
│   │   │   ├── admin/           # Protected endpoints
│   │   │   │   ├── run-cycle.ts       # SSE streaming cycle
│   │   │   │   ├── run-research.ts
│   │   │   │   ├── articles/          # CRUD
│   │   │   │   ├── agents/            # CRUD
│   │   │   │   └── ...
│   │   │   ├── analytics/       # Tracking endpoints
│   │   │   ├── auth/login.ts
│   │   │   └── ...
│   │   ├── index.astro          # Homepage
│   │   ├── about.astro
│   │   ├── privacy.astro
│   │   ├── terms.astro
│   │   ├── contact.astro
│   │   ├── rss.xml.js           # RSS feed (both sources)
│   │   └── sitemap.xml.ts       # Sitemap (both sources)
│   │
│   ├── components/              # Reusable Astro components
│   │   ├── BaseHead.astro       # Meta tags, GA Consent Mode
│   │   ├── Header.astro
│   │   ├── Footer.astro
│   │   ├── Analytics.astro
│   │   ├── CookieConsent.astro
│   │   ├── GoogleAnalytics.astro
│   │   ├── ThemeToggle.astro
│   │   └── ...
│   │
│   ├── layouts/
│   │   ├── Layout.astro         # Main site layout
│   │   ├── BlogPost.astro       # Blog post template
│   │   └── DashboardLayout.astro
│   │
│   ├── lib/
│   │   ├── orchestrator.ts      # Agent cycle orchestration
│   │   ├── embeddings.ts        # OpenAI embeddings
│   │   ├── db/postgres.ts       # Neon client
│   │   └── agents/              # Agent implementations
│   │       ├── base.ts
│   │       ├── analyst.ts
│   │       ├── strategist.ts
│   │       ├── editor.ts
│   │       ├── writer.ts
│   │       ├── humanizer.ts
│   │       └── seo.ts
│   │
│   ├── data/
│   │   ├── templates.ts         # AI prompt templates
│   │   ├── platforms.ts         # Crypto exchange data
│   │   └── affiliates.ts        # Link management
│   │
│   ├── styles/global.css        # Tailwind + design tokens
│   ├── content.config.ts        # Collection schema (Zod)
│   ├── consts.ts                # Site constants
│   └── middleware.ts            # Auth middleware
│
├── db/
│   ├── config.ts                # Astro DB schema
│   └── seed.ts
│
├── public/                      # Static assets
├── astro.config.mjs
├── tsconfig.json
├── package.json
├── vercel.json                  # Cron jobs config
└── CLAUDE.md                    # This file
```

---

## Common Development Tasks

### Adding a New Static Page
1. Create `/src/pages/your-page.astro`
2. Add route to `/src/pages/sitemap.xml.ts` → `staticPages` array
3. Optionally add to header/footer navigation

### Modifying Agent Behavior
1. **Code changes**: Edit `/src/lib/agents/<agent-name>.ts`
2. **Config changes**: Update Postgres `agents` table via dashboard or SQL
3. **Personality**: Modify `personality_config` JSON in database
4. **Behavior overrides**: Set temporary overrides for testing

### Creating Content

**Manual (File-based):**
1. Add MDX file to `/src/content/blog/`
2. Include required frontmatter (see schema in `content.config.ts`)
3. Restart dev server to pick up changes

**AI-Generated:**
1. Dashboard → `/dashboard/ai-articles`
2. Click "Run Editorial Cycle" or wait for cron
3. Review generated articles (status: draft)
4. Edit if needed, then publish
5. Published articles auto-sync to Astro DB

### Adding Affiliate Platforms
1. Update `/src/data/platforms.ts` with platform metadata
2. Add to Astro DB `Platform` table via seed or admin API
3. Reference in article frontmatter: `platforms: ['platform-slug']`

### Analytics & Tracking

**Page Views:**
- Automatically tracked by `<Analytics slug={slug}>` component in BlogPost layout
- Data stored in Astro DB `AnalyticsView` table

**Affiliate Clicks:**
- Tracked via `<AffiliateCTA>` component
- Data stored in `AnalyticsClick` table

**View Reports:**
- Dashboard → `/dashboard/analytics`
- API: GET `/api/analytics/stats`

---

## Authentication & Security

### Dashboard Access
- **Protected Routes**: `/dashboard/*`, `/api/admin/*`
- **Middleware**: `/src/middleware.ts` checks for cookie `dashboard_session=authenticated`
- **Login**: POST `/api/auth/login` with `DASHBOARD_PASSWORD` env var
- **Session**: Stateless cookie (no database sessions)

### Cron Job Authentication
- **Bypass**: Include header `Authorization: Bearer <CRON_SECRET>`
- **Verification**: Middleware checks header on `/api/admin/run-*` routes
- **Env var**: `CRON_SECRET` set in Vercel

---

## Build & Deployment

### Local Development
```bash
# Install dependencies
npm install

# Pull Vercel environment variables
vercel env pull .env.development.local

# Start dev server
npm run dev  # localhost:4321
```

### Build
```bash
# Production build (with remote DB access)
npm run build

# Preview build
npm run preview
```

### Deployment
- **Auto-deploy**: Push to `main` branch → Vercel auto-builds
- **Environment**: All secrets managed in Vercel dashboard
- **Required env vars**:
  - `DATABASE_URL` - Neon Postgres (auto-injected)
  - `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`
  - `DASHBOARD_PASSWORD` - Admin login
  - `CRON_SECRET` - Cron authentication
  - `VERCEL_BLOB_TOKEN` - File storage

### Cron Jobs (vercel.json)
```json
{
  "crons": [
    {
      "path": "/api/admin/run-research",
      "schedule": "0 2 * * *"           // Daily 2 AM
    },
    {
      "path": "/api/admin/run-cycle",
      "schedule": "0 8 * * 1,4"         // Mon/Thu 8 AM
    }
  ]
}
```

---

## Design System

### Color Palette
- **Primary**: Navy `#1B2D4F`
- **Secondary**: Cream `#F5F0EB`
- **Accent**: Gold/Orange for CTAs
- **Muted**: `#6B7280` for secondary text

### Typography
- **Font**: Outfit (@fontsource/outfit, weights 300-800)
- **Headings**: Navy, bold (Outfit 700-800)
- **Body**: Default (Outfit 400-500)
- **Max-width**: 65ch for prose

### Visual Effects
- **Halftone Pattern**: Editorial newspaper aesthetic
- **Duotone Images**: Navy screen blend on hero images
- **Glass Morphism**: `.glass` class for frosted UI elements
- **Dark Mode**: Toggle via `<ThemeToggle>`, persists to localStorage

### Layout Patterns
- **Mobile-first**: Tailwind responsive design
- **Blog Post**: Single column → 2/3 content + 1/3 sidebar (desktop)
- **Dashboard**: Sidebar nav + main content area
- **Cards**: Consistent border radius (8-12px), subtle shadows

---

## Performance Optimizations

1. **Image Optimization**: Sharp integration for WebP conversion
2. **Server-Side Rendering**: All routes dynamically rendered (no static gen)
3. **Database Queries**: Astro DB for fast reads, Postgres for complex analytics
4. **Caching**:
   - Sitemap: `max-age=3600` (1 hour)
   - Static assets: Vercel CDN
5. **Analytics**: Async loading, no blocking scripts
6. **CSS**: Tailwind 4 with JIT compilation

---

## Coding Conventions

### File Naming
- **Components**: PascalCase (e.g., `ThemeToggle.astro`)
- **Pages**: kebab-case (e.g., `ai-articles.astro`)
- **Utilities**: camelCase (e.g., `orchestrator.ts`)

### TypeScript
- **Strict mode**: Enabled (`tsconfig.json`)
- **Type imports**: Use `import type { ... }`
- **Zod schemas**: For all structured agent outputs
- **Avoid `any`**: Use proper types or `unknown`

### Astro Patterns
- **Frontmatter**: Server-side logic, imports, data fetching
- **Template**: HTML/JSX rendering
- **Scripts**: Client-side JS in `<script>` tags
- **Styles**: Scoped CSS in `<style>` tags

### API Routes
- **Naming**: `*.ts` for endpoints (not `.astro`)
- **HTTP methods**: Export `GET`, `POST`, `PUT`, `DELETE` functions
- **Responses**: Use `new Response()` with proper headers
- **Error handling**: Try/catch with JSON error responses

---

## Troubleshooting

### Common Issues

**Sitemap missing pages:**
- Check `/src/pages/sitemap.xml.ts` → `staticPages` array
- Ensure new pages are added to array

**Agent cycle fails:**
- Check Vercel logs for API errors
- Verify all API keys in env vars
- Check Postgres connection (`DATABASE_URL`)
- Review `agent_logs` table for specific errors

**Database queries fail:**
- Astro DB: Run `npx astro db push --remote` to sync schema
- Postgres: Check Neon dashboard for connection issues
- Local dev: Ensure `vercel env pull` was run

**Authentication issues:**
- Cookie: Check `dashboard_session=authenticated` is set
- Cron: Verify `Authorization: Bearer <CRON_SECRET>` header
- Password: Check `DASHBOARD_PASSWORD` env var

**Build errors:**
- TypeScript: Run `npx tsc --noEmit` to check types
- Astro: Check for invalid frontmatter or missing imports
- Dependencies: Run `npm install` to ensure all packages installed

---

## API Endpoints Reference

### Public APIs
- `GET /api/articles` - List published articles
- `GET /api/platforms` - Platform metadata
- `POST /api/contact` - Contact form submission
- `POST /api/trackAffiliateClick` - Track affiliate clicks
- `POST /api/analytics/track` - Track page views

### Admin APIs (Protected)
- `POST /api/admin/run-cycle` - Run full editorial cycle (SSE support)
- `POST /api/admin/run-research` - Run research phase only
- `GET/POST /api/admin/articles` - CRUD articles
- `GET/POST /api/admin/agents` - CRUD agent configs
- `GET /api/admin/logs` - Retrieve agent logs
- `GET /api/analytics/stats` - Aggregated analytics
- `GET /api/analytics/ai-performance` - Agent performance metrics

---

## Future Enhancements

### Planned Features
- Agent evolution system (auto-adjust based on metrics)
- A/B testing framework for agent personalities
- Multi-language support (NL/BE localization)
- Advanced SEO scoring dashboard
- Content recommendation engine (embedding-based)

### Technical Debt
- Migrate to centralized config management
- Add comprehensive test coverage (currently minimal)
- Implement rate limiting on public APIs
- Add request validation middleware

---

## Resources

- **Astro Docs**: https://docs.astro.build
- **Vercel AI SDK**: https://sdk.vercel.ai/docs
- **Astro DB**: https://docs.astro.build/en/guides/astro-db/
- **Tailwind 4**: https://tailwindcss.com/docs

---

**Last Updated**: February 2026
**Maintainer**: Claude Code + AI Agent System
**License**: Private (ShortNews.tech)
