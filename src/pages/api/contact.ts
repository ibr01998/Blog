// src/pages/api/contact.ts
// Handles contact form submissions and sends an email notification.
//
// Required environment variables:
//   RESEND_API_KEY     — Resend.com API key (https://resend.com)
//   CONTACT_EMAIL_TO   — Recipient email address (e.g. info@shortnews.tech)
//   CONTACT_EMAIL_FROM — Sender address verified in Resend (e.g. noreply@shortnews.tech)

import type { APIRoute } from 'astro';

const RATE_LIMIT_MAP = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 3;          // max submissions per window
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = RATE_LIMIT_MAP.get(ip);

  if (!entry || now > entry.resetAt) {
    RATE_LIMIT_MAP.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) return true;

  entry.count++;
  return false;
}

function sanitize(str: string, maxLen: number): string {
  return String(str).trim().slice(0, maxLen).replace(/[<>]/g, '');
}

const SUBJECT_LABELS: Record<string, string> = {
  general:     'Algemene vraag',
  privacy:     'Privacy / AVG verzoek',
  content:     'Fout in een artikel',
  partnership: 'Samenwerking / partnership',
  other:       'Overig',
};

export const POST: APIRoute = async ({ request }) => {
  // ── Rate limiting ──────────────────────────────────────────────────────────
  const ip = getClientIp(request);
  if (isRateLimited(ip)) {
    return new Response(
      JSON.stringify({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Ongeldig verzoek.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const name    = sanitize(String(body.name    ?? ''), 100);
  const email   = sanitize(String(body.email   ?? ''), 254);
  const subject = sanitize(String(body.subject ?? ''), 50);
  const message = sanitize(String(body.message ?? ''), 2000);

  // ── Validation ─────────────────────────────────────────────────────────────
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!name || name.length < 2) {
    return new Response(JSON.stringify({ error: 'Naam is verplicht.' }), { status: 400 });
  }
  if (!email || !emailRegex.test(email)) {
    return new Response(JSON.stringify({ error: 'Ongeldig e-mailadres.' }), { status: 400 });
  }
  if (!subject || !Object.keys(SUBJECT_LABELS).includes(subject)) {
    return new Response(JSON.stringify({ error: 'Kies een geldig onderwerp.' }), { status: 400 });
  }
  if (!message || message.length < 10) {
    return new Response(JSON.stringify({ error: 'Bericht te kort (minimaal 10 tekens).' }), { status: 400 });
  }

  // ── Send email via Resend ──────────────────────────────────────────────────
  const RESEND_API_KEY    = import.meta.env.RESEND_API_KEY;
  const CONTACT_EMAIL_TO  = import.meta.env.CONTACT_EMAIL_TO  || 'info@shortnews.tech';
  const CONTACT_EMAIL_FROM = import.meta.env.CONTACT_EMAIL_FROM || 'noreply@shortnews.tech';

  if (!RESEND_API_KEY) {
    // Dev fallback: log to console and acknowledge
    console.log('[contact] Email sending skipped (RESEND_API_KEY not set):', {
      name, email, subject, message
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const subjectLabel = SUBJECT_LABELS[subject] || subject;
  const htmlBody = `
    <h2 style="font-family:sans-serif;color:#1B2D4F">Nieuw contactbericht — ShortNews</h2>
    <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%">
      <tr><td style="padding:6px 12px;font-weight:600;width:120px;background:#f5f0eb">Naam</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${name}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;background:#f5f0eb">E-mail</td><td style="padding:6px 12px;border-bottom:1px solid #eee"><a href="mailto:${email}">${email}</a></td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;background:#f5f0eb">Onderwerp</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${subjectLabel}</td></tr>
      <tr><td style="padding:6px 12px;font-weight:600;vertical-align:top;background:#f5f0eb">Bericht</td><td style="padding:6px 12px;white-space:pre-wrap">${message}</td></tr>
    </table>
    <p style="font-family:sans-serif;font-size:12px;color:#888;margin-top:16px">
      Verstuurd via shortnews.tech/contact
    </p>
  `;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    CONTACT_EMAIL_FROM,
        to:      [CONTACT_EMAIL_TO],
        replyTo: email,
        subject: `[ShortNews Contact] ${subjectLabel} — ${name}`,
        html:    htmlBody,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.json().catch(() => ({}));
      console.error('[contact] Resend error:', err);
      return new Response(
        JSON.stringify({ error: 'E-mail kon niet worden verzonden. Probeer het later opnieuw.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch (err) {
    console.error('[contact] Fetch error:', err);
    return new Response(
      JSON.stringify({ error: 'E-mail kon niet worden verzonden. Probeer het later opnieuw.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

// Block all other methods
export const GET:    APIRoute = () => new Response(null, { status: 405 });
export const PUT:    APIRoute = () => new Response(null, { status: 405 });
export const DELETE: APIRoute = () => new Response(null, { status: 405 });
