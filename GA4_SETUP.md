# Google Analytics 4 API Setup Guide

This guide walks you through setting up GA4 API access for the AI agent system.

## Prerequisites

- Google Cloud Console access
- GA4 property admin access
- Vercel project access

---

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Note your Project ID

---

## Step 2: Enable Google Analytics Data API

1. In Google Cloud Console, go to **APIs & Services > Library**
2. Search for "Google Analytics Data API"
3. Click **Enable**

---

## Step 3: Create a Service Account

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > Service Account**
3. Enter details:
   - **Name**: `shortnews-analytics-reader`
   - **Description**: `Service account for ShortNews AI agents to read GA4 data`
   - **Role**: `Viewer` (or no role needed at this level)
4. Click **Done**

---

## Step 4: Generate Service Account Key

1. In the **Service Accounts** list, click on the account you just created
2. Go to the **Keys** tab
3. Click **Add Key > Create New Key**
4. Select **JSON** format
5. Click **Create** — a JSON file will download

The JSON file looks like this:
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBA...\n-----END PRIVATE KEY-----\n",
  "client_email": "shortnews-analytics-reader@your-project.iam.gserviceaccount.com",
  "client_id": "123456789...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://..."
}
```

**Extract these values:**
- `client_email` → will become `GA4_SERVICE_ACCOUNT_EMAIL`
- `private_key` → will become `GA4_PRIVATE_KEY` (base64 encoded)

---

## Step 5: Add Service Account to GA4

1. Go to your [Google Analytics](https://analytics.google.com/) account
2. Navigate to **Admin** (bottom left)
3. In the **Property** column, click **Property Access Management**
4. Click **Add users** (+ icon)
5. Enter the service account email (from JSON: `client_email`)
6. Select role: **Viewer**
7. Uncheck "Notify new users by email"
8. Click **Add**

---

## Step 6: Get Your GA4 Property ID

1. In Google Analytics, go to **Admin**
2. Click **Property Settings** (in the Property column)
3. Note the **Property ID** (format: `123456789`)
4. Your full property ID for the API is: `properties/123456789`

---

## Step 7: Prepare Environment Variables

### Extract Values from JSON Key

From the downloaded JSON file:

```bash
# Get the email (no encoding needed)
GA4_SERVICE_ACCOUNT_EMAIL="shortnews-analytics-reader@your-project.iam.gserviceaccount.com"

# Get the private key and base64 encode it
# Option 1: Using echo (preserves newlines)
echo -n "-----BEGIN PRIVATE KEY-----
MIIEvQIBA...
-----END PRIVATE KEY-----" | base64

# Option 2: Using pbcopy on macOS
echo -n "-----BEGIN PRIVATE KEY-----..." | base64 | pbcopy

# The result should be a single long string like:
# LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t...
```

### Environment Variables Summary

You need these three variables:

```bash
GA4_PROPERTY_ID="properties/123456789"
GA4_SERVICE_ACCOUNT_EMAIL="shortnews-analytics-reader@your-project.iam.gserviceaccount.com"
GA4_PRIVATE_KEY="LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t..." # base64 encoded
```

---

## Step 8: Add to Vercel

1. Go to your Vercel project dashboard
2. Click **Settings > Environment Variables**
3. Add each variable:
   - Variable name: `GA4_PROPERTY_ID`
   - Value: `properties/123456789`
   - Environment: **Production**, **Preview**, **Development** (check all)
   - Click **Save**
4. Repeat for `GA4_SERVICE_ACCOUNT_EMAIL` and `GA4_PRIVATE_KEY`

---

## Step 9: Test the Connection

### Option 1: Via Dashboard (Recommended)

Once deployed, visit:
```
https://your-domain.com/dashboard/login
→ Login
→ Open browser console and run:
fetch('/api/admin/test-ga4').then(r => r.json()).then(console.log)
```

### Option 2: Via cURL

```bash
# Get your CRON_SECRET from Vercel env vars
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-domain.com/api/admin/test-ga4
```

**Expected Success Response:**
```json
{
  "success": true,
  "message": "GA4 connection successful!",
  "sample_data": {
    "total_users": 1234,
    "total_sessions": 2345,
    "total_pageviews": 5678,
    "avg_session_duration": "2.5 minutes",
    "bounce_rate": "45.2%",
    "conversions": 89,
    "top_blog_posts": [...],
    "top_traffic_sources": [...]
  }
}
```

---

## Step 10: Verify Analyst Agent Integration

Run an editorial cycle and check the agent logs:

1. Go to `/dashboard/ai-articles`
2. Click **Run Editorial Cycle**
3. Wait for completion
4. Go to `/dashboard/agents` → Click on **Analyst** agent
5. View recent logs → Check for:
   - `ga4_available: true`
   - `ga4_total_users: <number>`
   - `ga4_total_pageviews: <number>`

If GA4 data is not available, the Analyst will still work but will fall back to Postgres metrics only.

---

## Troubleshooting

### Error: "GA4 connection failed"

**Possible causes:**
1. Service account email not added to GA4 property
2. Wrong Property ID format (should be `properties/123456789`)
3. Private key not base64 encoded correctly
4. API not enabled in Google Cloud Console

**How to debug:**
1. Check Vercel logs for detailed error messages
2. Verify all three env vars are set correctly
3. Test service account permissions in GA4 Admin
4. Ensure "Google Analytics Data API" is enabled

### Error: "Private key parsing failed"

The private key must be base64 encoded. Try:
```bash
# Verify your base64 encoding
echo "YOUR_BASE64_STRING" | base64 -d
# Should output: -----BEGIN PRIVATE KEY----- ...
```

### Data Shows Zero Users

**Possible causes:**
1. GA4 property is brand new (no data yet)
2. Date range is too narrow (try 30 days)
3. Service account has wrong permissions in GA4

---

## What the Analyst Gets from GA4

The Analyst agent now receives:

### Overall Metrics
- Total users, sessions, pageviews
- Average session duration
- Bounce rate
- Total conversions

### Content Performance
- Top blog posts (views, bounce rate, conversions)
- Most engaging articles
- Which topics drive traffic

### Traffic Sources
- Organic search vs social vs direct
- Top referrers
- Campaign performance

### Device Breakdown
- Mobile vs desktop vs tablet
- User behavior by device

### Conversion Events
- Affiliate clicks
- Newsletter signups
- Custom events

This rich data helps the Analyst make smarter recommendations about:
- Which content formats to prioritize
- Which platforms to focus on
- Whether to write shorter/longer articles
- Mobile optimization needs

---

## Security Notes

- **Never commit** the JSON key file to Git
- **Never log** the private key or decoded credentials
- Service account has **read-only** access (Viewer role)
- Use separate service accounts for prod/dev if needed
- Rotate keys periodically (every 90 days recommended)

---

## Next Steps

Once GA4 is connected:
1. Let the system run for 1-2 weeks to accumulate data
2. Review Analyst reports in `/dashboard/agents`
3. Check if GA4 insights improve content recommendations
4. Compare Postgres metrics with GA4 metrics for accuracy

---

## Additional Resources

- [Google Analytics Data API Documentation](https://developers.google.com/analytics/devguides/reporting/data/v1)
- [Service Account Authentication](https://cloud.google.com/docs/authentication/production)
- [GA4 Property Setup](https://support.google.com/analytics/answer/9304153)

---

**Last Updated**: 2026-02-19
