# Sakura Sushi — Deployment & Security Guide

## Overview
This document covers the security hardening implemented and the steps to deploy the site with full protection.

---

## Security Features Implemented

### 1. Admin Authentication — PBKDF2 (120,000 iterations)
- **No plaintext passwords** — only salted verifiers stored in localStorage
- **Default password:** `SakuraAdmin2024!Secure` (change immediately on first login)
- **Session timeout:** 30 minutes of inactivity
- **Re-authentication required** for destructive actions (delete, password change)

### 2. Form Protection
- **Honeypot field** (`website`) — hidden via CSS, bots fill it, humans don't see it
- **Cloudflare Turnstile** — invisible CAPTCHA, no user interaction required
- **Client-side rate limiting** — max 3 requests/minute per browser
- **Server-side rate limiting** (Worker) — max 5 requests/minute per IP
- **HTML sanitization** — all user inputs escaped before Telegram send

### 3. Telegram Token Protection
- **Bot token NEVER in frontend** — hidden in Cloudflare Worker environment variables
- **Worker proxy** validates Turnstile, rate limits, then forwards to Telegram API
- **CORS configured** — only your domain can call the Worker

### 4. XSS Prevention
- `escapeHtml()` and `escapeHtmlAttr()` used everywhere user data is rendered
- All admin panel data, reviews, menu items, orders — sanitized on output
- Toast messages, form errors, modals — all escaped

### 5. HTTPS Required
- Deploy to **Cloudflare Pages**, **Netlify**, or **Vercel** (all provide free HTTPS)
- Worker also runs on HTTPS (workers.dev or custom domain)

---

## Deployment Steps

### 1. Cloudflare Turnstile Setup
1. Go to [Cloudflare Turnstile Dashboard](https://dash.cloudflare.com/?to=/:account/turnstile)
2. Add a new site → enter your domain (e.g., `sakurasushi.pages.dev`)
3. Choose **"Managed" (invisible)** mode
4. Copy **Site Key** (public) and **Secret Key** (private)

### 2. Cloudflare Worker Deployment
1. Go to [Cloudflare Workers Dashboard](https://dash.cloudflare.com/?to=/:account/workers)
2. Create Worker → paste `worker-telegram-proxy.js`
3. **Settings → Variables** (add these):
   ```
   TELEGRAM_BOT_TOKEN = "9072371729:AAEV8LNg7Mt650QiZbK8txN7JXyrM9FaTIs"
   TELEGRAM_CHAT_ID = "-1003930814744"
   TURNSTILE_SECRET_KEY = "0x4AAAAAAA..."  # Your Turnstile secret key
   ALLOWED_ORIGIN = "https://your-domain.pages.dev"  # Or "*" for dev
   ```
4. Deploy → copy Worker URL (e.g., `https://sakura-order-worker.your-subdomain.workers.dev/api/order`)

### 3. Update Frontend Config
Edit `app.js` — update these constants:
```javascript
const CONFIG = {
  TELEGRAM_WORKER_URL: 'https://YOUR-WORKER-URL.workers.dev/api/order',
  TURNSTILE_SITE_KEY: '0x4AAAAAAA...',  // Your Turnstile Site Key
  // ... other settings
};
```

### 4. Deploy Site
**Option A: Cloudflare Pages (recommended)**
1. Push to GitHub/GitLab
2. Cloudflare Pages → Connect repository
3. Build command: (none — static site)
4. Output directory: `/` (root)
5. Deploy → get `*.pages.dev` URL

**Option B: Netlify**
1. Drag `sushi-site` folder to Netlify dashboard
2. Or connect Git repo
3. No build command needed

**Option C: Vercel**
1. `vercel` CLI or Git integration
2. Auto-detects static site

### 5. Test Everything
1. Visit your deployed site
2. Place a test order → check Telegram group
3. Open admin panel: `Ctrl+Shift+S` or `?admin=1`
4. Login with `SakuraAdmin2024!Secure`
5. **Immediately change password** in Settings tab
6. Test Turnstile: submit form → check Worker logs

---

## Admin Access Methods

| Method | How |
|--------|-----|
| Keyboard | `Ctrl+Shift+S` |
| URL | `https://yoursite.com/?admin=1` or `#admin` |
| Footer logo | Double-click the Sakura logo in footer |
| Persistent | After login, floating ⚙️ button appears bottom-left |

---

## Changing Admin Password

1. Open admin panel (`Ctrl+Shift+S`)
2. Go to **Settings** tab
3. Enter current password: `SakuraAdmin2024!Secure`
4. Enter new password (min 12 chars, mixed case, numbers, symbols)
5. Click "Змінити пароль"
6. New PBKDF2 verifier saved to localStorage

> **Note:** Password is never sent anywhere. Verification happens entirely in-browser via Web Crypto API.

---

## Local Development

```bash
# Serve locally (HTTPS not required for local testing)
cd C:\Users\Oleh\sushi-site
npx serve .
# or
python -m http.server 8080
```

For Turnstile testing locally:
- Add `localhost` to Turnstile allowed domains
- Or use `ALLOWED_ORIGIN = "*"` in Worker (dev only)

---

## Security Checklist Before Go-Live

- [ ] Turnstile configured with correct domain
- [ ] Worker deployed with all 4 environment variables
- [ ] `TELEGRAM_WORKER_URL` updated in `app.js`
- [ ] `TURNSTILE_SITE_KEY` updated in `app.js`
- [ ] Site deployed to HTTPS (Pages/Netlify/Vercel)
- [ ] Admin password changed from default
- [ ] Test order arrives in Telegram group
- [ ] Honeypot tested (fill hidden field → submission silently dropped)
- [ ] Rate limiting tested (rapid submissions → 429 error)
- [ ] XSS tested (submit `<script>alert(1)</script>` in name → rendered as text)
- [ ] Admin session expires after 30 min inactivity
- [ ] Re-auth required for delete actions

---

## Worker Logs & Monitoring

In Cloudflare Workers dashboard:
- **Logs** → see all requests, errors, Turnstile results
- **Metrics** → request count, errors, CPU time
- **Tail Workers** → real-time log streaming

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Worker not configured" toast | Check `TELEGRAM_WORKER_URL` in app.js matches deployed Worker |
| Turnstile not showing | Verify Site Key in app.js, check browser console for errors |
| CORS error | Ensure `ALLOWED_ORIGIN` in Worker matches your site URL exactly |
| Telegram 400 "chat not found" | Verify `TELEGRAM_CHAT_ID` in Worker env vars (must be supergroup ID) |
| Admin login fails | Clear localStorage, try default password; check PBKDF2 iterations match |
| Orders not in Telegram | Check Worker logs → Telegram API response |

---

## File Structure

```
sushi-site/
├── index.html           # Main HTML (with honeypot, Turnstile container)
├── styles.css           # All styles (including validation, admin, modals)
├── app.js               # Secure app logic (PBKDF2, sanitization, Worker proxy)
├── favicon.svg          # Brand icon
├── worker-telegram-proxy.js  # Cloudflare Worker (deploy separately)
├── DEPLOYMENT_SECURITY.md    # This file
└── CLAUDE.md            # Project rules
```

---

## Emergency Procedures

### Compromised Admin Session
1. Open DevTools → Application → LocalStorage
2. Delete `sakura_admin_session`, `sakura_admin_verifier`, `sakura_admin_salt`
3. Reload page → admin access gone
4. Re-initialize by visiting `?admin=1` (creates new verifier with default password)

### Compromised Telegram Bot Token
1. **Immediately revoke** in @BotFather: `/revoke`
2. Generate new token
3. Update `TELEGRAM_BOT_TOKEN` in Worker environment variables
4. Redeploy Worker

### Need to Reset Everything
```javascript
// In browser console:
localStorage.clear();
location.reload();
```

---

## Contact
For deployment help or security questions, refer to this guide or check Worker logs first.