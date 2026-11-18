/**
 * Cloudflare Worker — Telegram Bot Proxy for Sakura Sushi
 *
 * DEPLOYMENT:
 * 1. Go to Cloudflare Dashboard > Workers & Pages
 * 2. Create a new Worker
 * 3. Paste this code
 * 4. Add Environment Variables (Settings > Variables):
 *    - TELEGRAM_BOT_TOKEN = "9072371729:AAEV8LNg7Mt650QiZbK8txN7JXyrM9FaTIs"
 *    - TELEGRAM_CHAT_ID = "-1003930814744"
 *    - TURNSTILE_SECRET_KEY = "0x4AAAAAAA..." (from Cloudflare Turnstile dashboard)
 *    - ALLOWED_ORIGIN = "https://your-domain.com" (or "*" for dev)
 * 5. Deploy and copy the worker URL
 * 6. Update CONFIG.TELEGRAM_WORKER_URL in app.js
 * 7. Update CONFIG.TURNSTILE_SITE_KEY in app.js with your Turnstile site key
 */

export default {
  async fetch(request, env, ctx) {
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, corsHeaders);
    }

    // Rate limiting (per IP, in-memory - for production use Durable Objects or KV)
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitKey = `ratelimit:${clientIP}`;

    // Simple in-memory rate limit (resets on worker restart)
    // For production, use Cloudflare KV or Durable Objects
    if (!globalThis.rateLimitStore) globalThis.rateLimitStore = new Map();
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 5;

    const clientData = globalThis.rateLimitStore.get(rateLimitKey) || { timestamps: [] };
    clientData.timestamps = clientData.timestamps.filter(ts => now - ts < windowMs);

    if (clientData.timestamps.length >= maxRequests) {
      return jsonResponse({
        ok: false,
        error: 'Rate limit exceeded. Please wait before submitting again.',
        retryAfter: Math.ceil((clientData.timestamps[0] + windowMs - now) / 1000)
      }, 429, corsHeaders);
    }

    clientData.timestamps.push(now);
    globalThis.rateLimitStore.set(rateLimitKey, clientData);

    // Clean up old entries periodically
    if (globalThis.rateLimitStore.size > 10000) {
      for (const [key, data] of globalThis.rateLimitStore.entries()) {
        data.timestamps = data.timestamps.filter(ts => now - ts < windowMs);
        if (data.timestamps.length === 0) globalThis.rateLimitStore.delete(key);
      }
    }

    try {
      // Parse request body
      const body = await request.json();
      const { name, phone, address, comment, items, total, timestamp, turnstileToken } = body;

      // Validate required fields
      if (!name || !phone || !items || !items.length) {
        return jsonResponse({ ok: false, error: 'Missing required fields' }, 400, corsHeaders);
      }

      // Verify Turnstile token if provided
      if (turnstileToken && env.TURNSTILE_SECRET_KEY) {
        const turnstileResult = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, clientIP);
        if (!turnstileResult.success) {
          console.warn('[Worker] Turnstile verification failed:', turnstileResult);
          return jsonResponse({ ok: false, error: 'Security check failed. Please try again.' }, 400, corsHeaders);
        }
      }

      // Format message for Telegram
      const itemsText = items.map(item =>
        `• ${item.name} × ${item.qty} — ${formatPrice(item.price * item.qty)}`
      ).join('\n');

      const text = `🍣 <b>Нове замовлення Sakura Sushi</b>\n\n` +
        `👤 <b>Ім'я:</b> ${escapeHtml(name)}\n` +
        `📞 <b>Телефон:</b> ${escapeHtml(phone)}\n` +
        `📍 <b>Адреса:</b> ${address ? escapeHtml(address) : '— (самовивіз)'}\n` +
        `💬 <b>Коментар:</b> ${comment ? escapeHtml(comment) : '—'}\n\n` +
        `🧾 <b>Склад замовлення:</b>\n${itemsText}\n\n` +
        `💰 <b>Разом: ${formatPrice(total)}</b>\n` +
        `⏰ ${new Date(timestamp).toLocaleString('uk-UA')}`;

      // Send to Telegram
      const tgResponse = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: env.TELEGRAM_CHAT_ID,
            text,
            parse_mode: 'HTML'
          })
        }
      );

      const tgResult = await tgResponse.json();

      if (!tgResponse.ok) {
        console.error('[Worker] Telegram API error:', tgResult);
        // Don't expose internal errors to client
        return jsonResponse({
          ok: false,
          error: 'Failed to send notification. Order saved locally.'
        }, 502, corsHeaders);
      }

      return jsonResponse({
        ok: true,
        messageId: tgResult.result?.message_id,
        message: 'Order sent to Telegram successfully'
      }, 200, corsHeaders);

    } catch (err) {
      console.error('[Worker] Error:', err);
      return jsonResponse({ ok: false, error: 'Internal server error' }, 500, corsHeaders);
    }
  }
};

async function verifyTurnstile(token, secretKey, clientIP) {
  try {
    const formData = new FormData();
    formData.append('secret', secretKey);
    formData.append('response', token);
    formData.append('remoteip', clientIP);

    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData
    });

    return await response.json();
  } catch (err) {
    console.error('[Worker] Turnstile verification error:', err);
    return { success: false, 'error-codes': ['internal-error'] };
  }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

function formatPrice(price) {
  return `${price.toLocaleString('uk-UA')} ₴`;
}

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}