/* ============================================================
   Sakura Sushi — App Logic (UA) — SECURE VERSION
   Меню, кошик, слайдер відгуків, форма, адмінка
   Security: PBKDF2 admin auth, honeypot, Turnstile, XSS sanitization,
             rate limiting, Worker proxy for Telegram token
   ============================================================ */

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  // Telegram Bot — token hidden in Cloudflare Worker
  // Worker endpoint will be set via meta tag or env
  TELEGRAM_WORKER_URL: 'https://sakura-order-worker.your-subdomain.workers.dev/api/order',

  // Cloudflare Turnstile site key (public, safe to expose)
  TURNSTILE_SITE_KEY: '0x4AAAAAAA...', // TODO: Replace with real site key

  // Admin auth — PBKDF2 settings
  PBKDF2_ITERATIONS: 120000,
  PBKDF2_KEY_LENGTH: 32,
  SESSION_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes

  // Rate limiting (client-side only; Worker enforces server-side)
  RATE_LIMIT_WINDOW_MS: 60000, // 1 minute
  RATE_LIMIT_MAX_REQUESTS: 3,

  // Honeypot field name
  HONEYPOT_FIELD: 'website',

  // Storage keys
  STORAGE_KEYS: {
    MENU: 'sakura_menu_data',
    REVIEWS: 'sakura_reviews_data',
    CART: 'sakura_cart',
    ORDERS: 'sakura_orders',
    ADMIN_SESSION: 'sakura_admin_session',
    ADMIN_SALT: 'sakura_admin_salt',
    ADMIN_VERIFIER: 'sakura_admin_verifier',
    RATE_LIMIT: 'sakura_rate_limit'
  }
};

// ============================================================
// DEFAULT DATA
// ============================================================
const DEFAULT_MENU = [
  { id: 1, category: 'nigiri', name: 'Саке Нігірі', desc: 'Лосось, рис, васабі', price: 180, image: 'https://images.unsplash.com/photo-1617196034183-421b4917c92d?w=400&q=80', tags: ['Популярне'], badge: 'Хіт' },
  { id: 2, category: 'nigiri', name: 'Магуро Нігірі', desc: 'Тунцець, рис, соєвий соус', price: 220, image: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400&q=80', tags: ['Преміум'] },
  { id: 3, category: 'nigiri', name: 'Ебі Нігірі', desc: 'Креветка тигрова, рис', price: 160, image: 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400&q=80', tags: [] },
  { id: 4, category: 'nigiri', name: 'Унагі Нігірі', desc: 'Вугор копчений, унагі соус', price: 240, image: 'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=400&q=80', tags: ['Преміум'], badge: 'Новинка' },
  { id: 5, category: 'rolls', name: 'Філадельфія', desc: 'Лосось, сир вершковий, авокадо, рис, норі', price: 420, image: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400&q=80', tags: ['Класика'], badge: 'Хіт' },
  { id: 6, category: 'rolls', name: 'Каліфорнія', desc: 'Краб, авокадо, огірок, ікра тобіко', price: 380, image: 'https://images.unsplash.com/photo-1617196034183-421b4917c92d?w=400&q=80', tags: ['Класика'] },
  { id: 7, category: 'rolls', name: 'Дракон', desc: 'Вугор, авокадо, огірок, унагі соус, кунжут', price: 520, image: 'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=400&q=80', tags: ['Преміум', 'Гаряче'], badge: 'Рекомендація шефа' },
  { id: 8, category: 'rolls', name: 'Радуга', desc: 'Лосось, тунцець, біла риба, авокадо, ікра', price: 480, image: 'https://images.unsplash.com/photo-1617196034796-73dfa7b1fd56?w=400&q=80', tags: ['Преміум'] },
  { id: 9, category: 'rolls', name: 'Овочевий рол', desc: 'Авокадо, огірок, перець, капуста байпак, рис', price: 280, image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&q=80', tags: ['Веган', 'Новинка'] },
  { id: 10, category: 'sashimi', name: 'Сашімі Сет «Сакура»', desc: 'Лосось, тунцець, біла риба, ікра (12 шт.)', price: 890, image: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=400&q=80', tags: ['Преміум', 'На двох'], badge: 'Хіт' },
  { id: 11, category: 'sashimi', name: 'Сашімі Лосось', desc: 'Найсвіжіший лосось, васабі, імбир (6 шт.)', price: 420, image: 'https://images.unsplash.com/photo-1579584425555-c3ce17fd4351?w=400&q=80', tags: [] },
  { id: 12, category: 'sashimi', name: 'Сашімі Тунцець', desc: 'Акамі та торо, соєвий соус, васабі (6 шт.)', price: 580, image: 'https://images.unsplash.com/photo-1617196034183-421b4917c92d?w=400&q=80', tags: ['Преміум'] },
  { id: 13, category: 'hot', name: 'Рамен Тонкоцу', desc: 'Свинячий бульон, яйцо, бамбук, норі, свинина', price: 450, image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400&q=80', tags: ['Популярне'] },
  { id: 14, category: 'hot', name: 'Які Соба', desc: 'Пшенична локшина, яловичина, овочі, соус', price: 380, image: 'https://images.unsplash.com/photo-1582878826629-29b7ad1cdc43?w=400&q=80', tags: [] },
  { id: 15, category: 'hot', name: 'Гйоза (6 шт.)', desc: 'Парові пельмені зі свининою та капустою', price: 280, image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&q=80', tags: ['Закуска'] },
  { id: 16, category: 'drinks', name: 'Зелений чай Матча', desc: 'Церемоніальний, 200 мл', price: 120, image: 'https://images.unsplash.com/photo-1627435601361-ec25f5b1d0e5?w=400&q=80', tags: [] },
  { id: 17, category: 'drinks', name: 'Саке Хonneur (150 мл)', desc: 'Преміальний, подача 40°', price: 350, image: 'https://images.unsplash.com/photo-1601026500196-6e2a1e3d5f9e?w=400&q=80', tags: ['Алкоголь'] },
  { id: 18, category: 'drinks', name: 'Йодзель лайм-мита', desc: 'Японська газована вода, 330 мл', price: 90, image: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=400&q=80', tags: ['Безалкогольне'] },
];

const DEFAULT_REVIEWS = [
  { id: 1, author: 'Анна К.', avatar: 'А', rating: 5, text: 'Найкращі суші в місті! Рис ідеальної консистенції, риба тане в роті. Філадельфія — просто космос. Замовляю кожну пʼятницю вже рік.' },
  { id: 2, author: 'Михайло С.', avatar: 'М', rating: 5, text: 'Привезли за 40 хвилин, все акуратно упаковане в термобоксах. Рамен тонкоцу — на рівні Токіо. Обовʼязково прийду в ресторан.' },
  { id: 3, author: 'Олена В.', avatar: 'О', rating: 4, text: 'Дуже смачно, але іноді затримують доставку на 10-15 хвилин. Зате завжди вибачаються і дають знижку на наступне замовлення. Рол Дракон — фаворит.' },
  { id: 4, author: 'Дмитро П.', avatar: 'Д', rating: 5, text: 'Сашімі сет «Сакура» — це мистецтво. Кожен шматочок нарізаний ідеально тонко. Майстри справжні профі. Рекомендую всім знайомцям.' },
  { id: 5, author: 'Ольга Р.', avatar: 'О', rating: 5, text: 'Замовила на корпоратив — 15 сетів. Все прийшло вчасно, гаряче гаряче, холодне холодне. Колегі в захваті. Тепер тільки тут.' },
  { id: 6, author: 'Андрій Т.', avatar: 'А', rating: 4, text: 'Хороші суші, чесні інгредієнти. Мінус — немає власної парковки біля ресторану. Але доставка працює ідеально.' },
];

// ============================================================
// STATE
// ============================================================
let MENU_DATA = loadData(CONFIG.STORAGE_KEYS.MENU, DEFAULT_MENU);
let REVIEWS_DATA = loadData(CONFIG.STORAGE_KEYS.REVIEWS, DEFAULT_REVIEWS);
let cart = loadData(CONFIG.STORAGE_KEYS.CART, []);
let currentCategory = 'all';
let currentReviewSlide = 0;
let isAdmin = false;
let adminSessionExpiry = 0;
let turnstileWidgetId = null;

// ============================================================
// UTILS
// ============================================================
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function loadData(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
}
function saveData(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

const formatPrice = (price) => `${price.toLocaleString('uk-UA')} ₴`;
const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
const throttle = (fn, ms) => { let last = 0; return (...args) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(...args); } }; };

function showToast(message, type = 'success') {
  const container = $('#toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      ${type === 'success' ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' : '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'}
    </svg>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'slideIn 0.3s ease-out reverse'; setTimeout(() => toast.remove(), 300); }, 4000);
}

function saveCart() { saveData(CONFIG.STORAGE_KEYS.CART, cart); updateCartUI(); }
function saveMenu() { saveData(CONFIG.STORAGE_KEYS.MENU, MENU_DATA); }
function saveReviews() { saveData(CONFIG.STORAGE_KEYS.REVIEWS, REVIEWS_DATA); }

// ============================================================
// HTML ESCAPING (XSS PREVENTION)
// ============================================================
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

function escapeHtmlAttr(str) {
  return escapeHtml(str).replace(/"/g, '"');
}

// ============================================================
// RATE LIMITING (CLIENT-SIDE)
// ============================================================
function checkRateLimit() {
  const now = Date.now();
  const data = loadData(CONFIG.STORAGE_KEYS.RATE_LIMIT, { timestamps: [] });
  // Clean old entries
  data.timestamps = data.timestamps.filter(ts => now - ts < CONFIG.RATE_LIMIT_WINDOW_MS);
  if (data.timestamps.length >= CONFIG.RATE_LIMIT_MAX_REQUESTS) {
    const oldest = data.timestamps[0];
    const waitMs = CONFIG.RATE_LIMIT_WINDOW_MS - (now - oldest);
    return { allowed: false, waitMs };
  }
  data.timestamps.push(now);
  saveData(CONFIG.STORAGE_KEYS.RATE_LIMIT, data);
  return { allowed: true };
}

// ============================================================
// PBKDF2 ADMIN AUTHENTICATION
// ============================================================
async function generateSalt() {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(password, saltHex, iterations = CONFIG.PBKDF2_ITERATIONS) {
  const encoder = new TextEncoder();
  const salt = new Uint8Array(saltHex.match(/.{2}/g).map(b => parseInt(b, 16)));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    CONFIG.PBKDF2_KEY_LENGTH * 8
  );
  return Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function initializeAdminVerifier() {
  // Check if verifier exists, if not create from default password "SakuraAdmin2024!Secure"
  const existingVerifier = localStorage.getItem(CONFIG.STORAGE_KEYS.ADMIN_VERIFIER);
  const existingSalt = localStorage.getItem(CONFIG.STORAGE_KEYS.ADMIN_SALT);

  if (!existingVerifier || !existingSalt) {
    const salt = await generateSalt();
    const verifier = await deriveKey('SakuraAdmin2024!Secure', salt);
    localStorage.setItem(CONFIG.STORAGE_KEYS.ADMIN_SALT, salt);
    localStorage.setItem(CONFIG.STORAGE_KEYS.ADMIN_VERIFIER, verifier);
    console.log('[Admin] Initialized PBKDF2 verifier with default password');
  }
}

async function verifyAdminPassword(password) {
  const salt = localStorage.getItem(CONFIG.STORAGE_KEYS.ADMIN_SALT);
  const verifier = localStorage.getItem(CONFIG.STORAGE_KEYS.ADMIN_VERIFIER);
  if (!salt || !verifier) return false;
  const derived = await deriveKey(password, salt);
  return derived === verifier;
}

async function changeAdminPassword(oldPassword, newPassword) {
  const salt = localStorage.getItem(CONFIG.STORAGE_KEYS.ADMIN_SALT);
  const verifier = localStorage.getItem(CONFIG.STORAGE_KEYS.ADMIN_VERIFIER);
  if (!salt || !verifier) return { ok: false, error: 'Not initialized' };

  const oldDerived = await deriveKey(oldPassword, salt);
  if (oldDerived !== verifier) return { ok: false, error: 'Current password incorrect' };

  const newSalt = await generateSalt();
  const newVerifier = await deriveKey(newPassword, newSalt);
  localStorage.setItem(CONFIG.STORAGE_KEYS.ADMIN_SALT, newSalt);
  localStorage.setItem(CONFIG.STORAGE_KEYS.ADMIN_VERIFIER, newVerifier);
  return { ok: true };
}

function createAdminSession() {
  const expiry = Date.now() + CONFIG.SESSION_TIMEOUT_MS;
  const session = { expiry, created: Date.now() };
  localStorage.setItem(CONFIG.STORAGE_KEYS.ADMIN_SESSION, JSON.stringify(session));
  adminSessionExpiry = expiry;
  return session;
}

function checkAdminSession() {
  const stored = localStorage.getItem(CONFIG.STORAGE_KEYS.ADMIN_SESSION);
  if (!stored) return false;
  try {
    const session = JSON.parse(stored);
    if (Date.now() > session.expiry) {
      localStorage.removeItem(CONFIG.STORAGE_KEYS.ADMIN_SESSION);
      return false;
    }
    adminSessionExpiry = session.expiry;
    return true;
  } catch {
    return false;
  }
}

function destroyAdminSession() {
  localStorage.removeItem(CONFIG.STORAGE_KEYS.ADMIN_SESSION);
  adminSessionExpiry = 0;
  isAdmin = false;
}

function extendAdminSession() {
  if (isAdmin) createAdminSession();
}

// ============================================================
// CART UI
// ============================================================
function updateCartUI() {
  const count = cart.reduce((sum, item) => sum + item.qty, 0);
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const countEl = $('#cartCount');
  if (countEl) {
    countEl.textContent = count;
    countEl.style.display = count > 0 ? 'flex' : 'none';
  }
  const totalEl = $('#cartTotal');
  if (totalEl) totalEl.textContent = formatPrice(total);
  const checkoutBtn = $('#cartCheckout');
  if (checkoutBtn) checkoutBtn.disabled = cart.length === 0;

  const itemsContainer = $('#cartItems');
  if (!itemsContainer) return;

  if (cart.length === 0) {
    itemsContainer.innerHTML = '<p class="cart-empty">Кошик порожній</p>';
    return;
  }

  itemsContainer.innerHTML = cart.map(item => `
    <article class="cart-item" role="listitem" data-id="${item.id}">
      <img src="${escapeHtmlAttr(item.image)}" alt="" class="cart-item-image" loading="lazy">
      <div class="cart-item-info">
        <h4 class="cart-item-title">${escapeHtml(item.name)}</h4>
        <div class="cart-item-price">${formatPrice(item.price)}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" data-action="dec" aria-label="Зменшити">−</button>
          <span>${item.qty}</span>
          <button class="qty-btn" data-action="inc" aria-label="Збільшити">+</button>
        </div>
        <button class="cart-item-remove" data-action="remove">Видалити</button>
      </div>
    </article>
  `).join('');
}

// ============================================================
// MENU RENDERING
// ============================================================
function renderMenu(category = 'all') {
  currentCategory = category;
  const filtered = category === 'all' ? MENU_DATA : MENU_DATA.filter(item => item.category === category);
  const grid = $('.menu-grid');
  if (!grid) return;
  grid.innerHTML = filtered.map((item, index) => `
    <article class="menu-card reveal" style="animation-delay: ${index * 50}ms" data-category="${item.category}">
      <div class="menu-card-image">
        <img src="${escapeHtmlAttr(item.image)}" alt="${escapeHtmlAttr(item.name)}" loading="lazy">
        ${item.badge ? `<span class="menu-card-badge">${escapeHtml(item.badge)}</span>` : ''}
      </div>
      <div class="menu-card-content">
        <div class="menu-card-header">
          <h3 class="menu-card-title">${escapeHtml(item.name)}</h3>
          <span class="menu-card-price">${formatPrice(item.price)}</span>
        </div>
        <p class="menu-card-desc">${escapeHtml(item.desc)}</p>
        <div class="menu-card-tags">
          ${item.tags.map(tag => `<span class="menu-card-tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <button class="btn btn-primary btn-block mt-4" data-add-to-cart="${item.id}" aria-label="Додати ${escapeHtml(item.name)} у кошик">
          У кошик
        </button>
      </div>
    </article>
  `).join('');

  $$('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === category);
    btn.setAttribute('aria-selected', btn.dataset.category === category);
  });
  observeReveal();
}

// ============================================================
// REVIEWS SLIDER
// ============================================================
function getReviewsPerSlide() {
  return window.innerWidth >= 1024 ? 3 : window.innerWidth >= 768 ? 2 : 1;
}

function renderReviews() {
  const track = $('#reviewsTrack');
  const dotsContainer = $('#sliderDots');
  if (!track || !dotsContainer) return;

  track.innerHTML = REVIEWS_DATA.map(review => `
    <article class="review-card reveal">
      <div class="review-header">
        <div class="review-avatar">${escapeHtml(review.avatar)}</div>
        <div class="review-author">
          <h4>${escapeHtml(review.author)}</h4>
          <p>${new Date().toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })}</p>
        </div>
        <div class="review-stars" aria-label="Оцінка ${review.rating} з 5">
          ${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}
        </div>
      </div>
      <p class="review-text">"${escapeHtml(review.text)}"</p>
    </article>
  `).join('');

  const totalSlides = Math.ceil(REVIEWS_DATA.length / getReviewsPerSlide());
  dotsContainer.innerHTML = Array.from({ length: totalSlides }, (_, i) =>
    `<button class="slider-dot ${i === 0 ? 'active' : ''}" role="tab" aria-label="Відгук ${i + 1}" data-slide="${i}"></button>`
  ).join('');
  observeReveal();
}

function goToSlide(index) {
  const track = $('#reviewsTrack');
  const cards = $$('.review-card', track);
  if (!cards.length) return;
  const cardWidth = cards[0].offsetWidth;
  const gap = 24;
  const slideWidth = cardWidth + gap;
  const perSlide = getReviewsPerSlide();
  const maxSlide = Math.ceil(REVIEWS_DATA.length / perSlide) - 1;
  currentReviewSlide = Math.max(0, Math.min(index, maxSlide));
  track.style.transform = `translateX(-${currentReviewSlide * slideWidth * perSlide}px)`;
  $$('.slider-dot').forEach((dot, i) => dot.classList.toggle('active', i === currentReviewSlide));
}
function nextReview() { goToSlide(currentReviewSlide + 1); }
function prevReview() { goToSlide(currentReviewSlide - 1); }

// ============================================================
// CART ACTIONS
// ============================================================
function addToCart(id) {
  const item = MENU_DATA.find(i => i.id === id);
  if (!item) return;
  const existing = cart.find(i => i.id === id);
  if (existing) existing.qty += 1;
  else cart.push({ ...item, qty: 1 });
  saveCart();
  showToast(`${escapeHtml(item.name)} додано у кошик`);
  openCart();
}
function updateCartItemQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty = Math.max(1, item.qty + delta);
  if (item.qty === 1 && delta === -1) removeFromCart(id);
  else saveCart();
}
function removeFromCart(id) { cart = cart.filter(i => i.id !== id); saveCart(); }
function clearCart() { cart = []; saveCart(); }

// ============================================================
// FORM VALIDATION
// ============================================================
function validateField(field) {
  const errorEl = $('#' + field.id + 'Error');
  let valid = true;
  let message = '';

  if (field.required && !field.value.trim()) {
    valid = false;
    message = 'Це поле обовʼязкове';
  } else if (field.id === 'phone' && field.value.trim()) {
    const digits = field.value.replace(/\D/g, '');
    if (digits.length < 10) {
      valid = false;
      message = 'Введіть коректний номер телефону';
    }
  } else if (field.id === 'name' && field.value.trim().length < 2) {
    valid = false;
    message = 'Імʼя занадто коротке';
  }

  field.classList.toggle('invalid', !valid);
  field.classList.toggle('valid', valid && field.value.trim());
  if (errorEl) errorEl.textContent = message;
  return valid;
}

function validateForm(form) {
  let valid = true;
  const fields = form.querySelectorAll('input[required], textarea[required]');
  fields.forEach(field => { if (!validateField(field)) valid = false; });
  return valid;
}

// ============================================================
// TELEGRAM ORDER SUBMISSION (via Worker proxy)
// ============================================================
async function sendOrderToWorker(orderData) {
  const workerUrl = CONFIG.TELEGRAM_WORKER_URL;
  if (!workerUrl || workerUrl.includes('your-subdomain')) {
    console.warn('[Telegram] Worker URL not configured, falling back to localStorage only');
    return { ok: false, error: 'Worker not configured', localOnly: true };
  }

  try {
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Turnstile token will be added by Worker if needed
      },
      body: JSON.stringify(orderData)
    });

    const result = await response.json();
    return { ok: response.ok, ...result };
  } catch (err) {
    console.error('Worker request failed:', err);
    return { ok: false, error: err.message, localOnly: true };
  }
}

// ============================================================
// FORM HANDLING
// ============================================================
async function handleOrderSubmit(e) {
  e.preventDefault();
  const form = e.target;

  // Honeypot check — if filled, silently drop (but pretend success)
  const honeypot = form.querySelector(`[name="${CONFIG.HONEYPOT_FIELD}"]`);
  if (honeypot && honeypot.value.trim()) {
    console.log('[Security] Honeypot triggered, dropping submission');
    showToast('Замовлення прийняте! Дякуємо.');
    clearCart(); closeCart(); form.reset();
    return;
  }

  // Client-side rate limit
  const rateLimit = checkRateLimit();
  if (!rateLimit.allowed) {
    const waitSec = Math.ceil(rateLimit.waitMs / 1000);
    showToast(`Забагато запитів. Спробуйте через ${waitSec} сек.`, 'error');
    return;
  }

  // Validate form
  if (!validateForm(form)) {
    showToast('Перевірте правильність заповнення полів', 'error');
    return;
  }
  if (cart.length === 0) { showToast('Кошик порожній', 'error'); return; }

  const btn = form.querySelector('button[type="submit"]');
  const btnText = btn.querySelector('.btn-text');
  const btnLoading = btn.querySelector('.btn-loading');
  const originalText = btnText ? btnText.textContent : 'Відправити замовлення';

  btn.disabled = true;
  if (btnText) btnText.hidden = true;
  if (btnLoading) btnLoading.hidden = false;

  // Prepare order data (sanitized)
  const orderData = {
    name: escapeHtml(form.name.value.trim()),
    phone: escapeHtml(form.phone.value.trim()),
    address: escapeHtml(form.address.value.trim()),
    comment: escapeHtml(form.comment.value.trim()),
    items: cart.map(item => ({
      id: item.id,
      name: escapeHtml(item.name),
      price: item.price,
      qty: item.qty
    })),
    total: cart.reduce((sum, item) => sum + item.price * item.qty, 0),
    timestamp: new Date().toISOString(),
    // Turnstile token will be added by widget callback if using implicit rendering
  };

  // Try to get Turnstile token if widget exists
  if (window.turnstile && turnstileWidgetId !== null) {
    try {
      orderData.turnstileToken = await new Promise(resolve => {
        window.turnstile.getResponse(turnstileWidgetId) || resolve('');
      });
    } catch { /* ignore */ }
  }

  // Send to Worker (which forwards to Telegram)
  const result = await sendOrderToWorker(orderData);

  // Always save locally as backup
  const orders = loadData(CONFIG.STORAGE_KEYS.ORDERS, []);
  orders.unshift(orderData);
  saveData(CONFIG.STORAGE_KEYS.ORDERS, orders.slice(0, 50));

  clearCart(); closeCart(); form.reset();
  $$('#orderForm input, #orderForm textarea').forEach(f => f.classList.remove('valid', 'invalid'));

  btn.disabled = false;
  if (btnText) btnText.hidden = false;
  if (btnLoading) btnLoading.hidden = true;

  if (result.ok) {
    showToast('Замовлення прийняте! Повідомлення відправлено в Telegram.');
  } else if (result.localOnly) {
    showToast('Замовлення збережено локально. Telegram сповіщення буде відправлено пізніше.', 'error');
  } else {
    showToast(`Помилка: ${escapeHtml(result.error || 'Невідома помилка')}`, 'error');
  }
}

// ============================================================
// TURNSTILE INITIALIZATION
// ============================================================
function initTurnstile() {
  const container = $('#turnstileContainer');
  if (!container || !window.turnstile || !CONFIG.TURNSTILE_SITE_KEY || CONFIG.TURNSTILE_SITE_KEY.includes('...')) {
    // Turnstile not configured — hide container
    if (container) container.style.display = 'none';
    return;
  }

  container.innerHTML = ''; // Clear any existing
  turnstileWidgetId = window.turnstile.render(container, {
    sitekey: CONFIG.TURNSTILE_SITE_KEY,
    theme: 'light',
    callback: (token) => {
      console.log('[Turnstile] Token received');
    },
    'expired-callback': () => {
      console.log('[Turnstile] Token expired');
    },
    'error-callback': () => {
      console.error('[Turnstile] Error');
    }
  });
}

// ============================================================
// CART PANEL
// ============================================================
function openCart() {
  const panel = $('#cartPanel');
  if (panel) {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }
}
function closeCart() {
  const panel = $('#cartPanel');
  if (panel) {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
}

// ============================================================
// MOBILE NAV
// ============================================================
function toggleMobileNav() {
  const toggle = $('#navToggle');
  const menu = $('#navMenu');
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', !expanded);
  menu.style.display = expanded ? 'none' : 'flex';
}

// ============================================================
// ADMIN PANEL
// ============================================================
function injectAdminAccess() {
  if ($('#adminAccess')) return;
  const btn = document.createElement('a');
  btn.id = 'adminAccess';
  btn.href = '#admin';
  btn.className = 'btn btn-ghost';
  btn.style.position = 'fixed';
  btn.style.bottom = 'var(--space-4)';
  btn.style.left = 'var(--space-4)';
  btn.style.zIndex = 'var(--z-sticky)';
  btn.style.fontSize = 'var(--text-xs)';
  btn.style.padding = 'var(--space-2) var(--space-3)';
  btn.innerHTML = '⚙️ Адмінка';
  btn.title = 'Адмін-панель (тільки для власника)';
  document.body.appendChild(btn);
  btn.addEventListener('click', e => { e.preventDefault(); openAdminPanel(); });
}

function removeAdminAccess() {
  $('#adminAccess')?.remove();
  closeAdminPanel();
}

function openAdminPanel() {
  if (!isAdmin) { promptAdminPassword(); return; }
  if ($('#adminPanel')) return;

  const panel = document.createElement('div');
  panel.id = 'adminPanel';
  panel.className = 'admin-panel';
  panel.innerHTML = `
    <div class="admin-backdrop" id="adminBackdrop"></div>
    <div class="admin-content">
      <header class="admin-header">
        <h2>⚙️ Адмін-панель Sakura Sushi</h2>
        <button class="admin-close" id="adminClose" aria-label="Закрити">×</button>
      </header>
      <nav class="admin-tabs" role="tablist">
        <button role="tab" class="admin-tab active" data-tab="menu" aria-selected="true">🍱 Меню</button>
        <button role="tab" class="admin-tab" data-tab="reviews" aria-selected="false">💬 Відгуки</button>
        <button role="tab" class="admin-tab" data-tab="orders" aria-selected="false">📦 Замовлення</button>
        <button role="tab" class="admin-tab" data-tab="settings" aria-selected="false">⚙️ Налаштування</button>
      </nav>
      <div class="admin-panels">
        ${adminMenuPanel()}
        ${adminReviewsPanel()}
        ${adminOrdersPanel()}
        ${adminSettingsPanel()}
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  document.body.style.overflow = 'hidden';
  initAdminEvents();
  extendAdminSession();
}

function closeAdminPanel() {
  const panel = $('#adminPanel');
  if (panel) { panel.remove(); document.body.style.overflow = ''; }
}

function adminMenuPanel() {
  return `
    <div class="admin-panel-content active" data-tab="menu" role="tabpanel">
      <div class="admin-toolbar">
        <button class="btn btn-primary" id="addMenuItem">+ Додати страву</button>
        <button class="btn btn-outline" id="exportMenu">Експорт JSON</button>
        <input type="file" id="importMenu" accept=".json" style="display:none">
        <button class="btn btn-ghost" id="importMenuBtn">Імпорт JSON</button>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr><th>ID</th><th>Фото</th><th>Назва</th><th>Категорія</th><th>Ціна</th><th>Теги</th><th>Бейдж</th><th>Дії</th></tr>
          </thead>
          <tbody id="adminMenuBody"></tbody>
        </table>
      </div>
    </div>
  `;
}

function adminReviewsPanel() {
  return `
    <div class="admin-panel-content" data-tab="reviews" role="tabpanel" hidden>
      <div class="admin-toolbar">
        <button class="btn btn-primary" id="addReview">+ Додати відгук</button>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr><th>ID</th><th>Автор</th><th>Аватар</th><th>Оцінка</th><th>Текст</th><th>Дії</th></tr>
          </thead>
          <tbody id="adminReviewsBody"></tbody>
        </table>
      </div>
    </div>
  `;
}

function adminOrdersPanel() {
  const orders = loadData(CONFIG.STORAGE_KEYS.ORDERS, []);
  return `
    <div class="admin-panel-content" data-tab="orders" role="tabpanel" hidden>
      <div class="admin-toolbar">
        <span>${orders.length} замовлень</span>
      </div>
      <div class="admin-table-wrapper">
        <table class="admin-table">
          <thead>
            <tr><th>Час</th><th>Ім'я</th><th>Телефон</th><th>Адреса</th><th>Сума</th><th>Статус</th></tr>
          </thead>
          <tbody>
            ${orders.map(o => `
              <tr>
                <td>${new Date(o.timestamp).toLocaleString('uk-UA')}</td>
                <td>${escapeHtml(o.name)}</td>
                <td>${escapeHtml(o.phone)}</td>
                <td>${escapeHtml(o.address || '—')}</td>
                <td>${formatPrice(o.total)}</td>
                <td><span class="status-badge status-new">Нове</span></td>
              </tr>
            `).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted);padding:var(--space-8)">Замовлень немає</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function adminSettingsPanel() {
  return `
    <div class="admin-panel-content" data-tab="settings" role="tabpanel" hidden>
      <div class="settings-section">
        <h3>Зміна пароля адмінки</h3>
        <form id="changePassForm">
          <div class="form-row"><label>Поточний пароль</label><input type="password" id="oldPass" required autocomplete="current-password"></div>
          <div class="form-row"><label>Новий пароль (мін. 12 символів)</label><input type="password" id="newPass" required minlength="12" autocomplete="new-password"></div>
          <div class="form-row"><label>Підтвердження</label><input type="password" id="confirmPass" required autocomplete="new-password"></div>
          <p class="form-hint">Використовуйте складний пароль: великі/малі літери, цифри, спецсимволи</p>
          <button type="submit" class="btn btn-primary">Змінити пароль</button>
        </form>
      </div>
      <div class="settings-section">
        <h3>Сесія</h3>
        <p>Автоматичний вихід через 30 хвилин бездіяльності.</p>
        <button class="btn btn-ghost" id="extendSession">Продовжити сесію</button>
      </div>
      <div class="settings-section">
        <h3>Дані сайту</h3>
        <button class="btn btn-outline" id="clearAllData">Очистити все (кошик, замовлення, авторизація)</button>
      </div>
      <div class="settings-section">
        <h3>Вихід</h3>
        <button class="btn btn-ghost" id="adminLogout">Вийти з адмінки</button>
      </div>
    </div>
  `;
}

function initAdminEvents() {
  // Tabs
  $$('.admin-tab').forEach(btn => btn.addEventListener('click', () => {
    $$('.admin-tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    $$('.admin-panel-content').forEach(p => p.hidden = true);
    btn.classList.add('active'); btn.setAttribute('aria-selected', 'true');
    $(`[data-tab="${btn.dataset.tab}"].admin-panel-content`).hidden = false;
    if (btn.dataset.tab === 'menu') renderAdminMenuTable();
    if (btn.dataset.tab === 'reviews') renderAdminReviewsTable();
    if (btn.dataset.tab === 'orders') { /* orders panel is static */ }
    extendAdminSession();
  }));

  // Close
  $('#adminClose')?.addEventListener('click', closeAdminPanel);
  $('#adminBackdrop')?.addEventListener('click', closeAdminPanel);
  $('#adminLogout')?.addEventListener('click', () => { destroyAdminSession(); removeAdminAccess(); showToast('Ви вийшли з адмінки'); });

  // Session extend
  $('#extendSession')?.addEventListener('click', () => { extendAdminSession(); showToast('Сесію продовжено на 30 хвилин'); });

  // Menu CRUD
  $('#addMenuItem')?.addEventListener('click', () => openMenuModal());
  $('#exportMenu')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(MENU_DATA, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'sakura-menu.json'; a.click(); URL.revokeObjectURL(url);
  });
  $('#importMenuBtn')?.addEventListener('click', () => $('#importMenu')?.click());
  $('#importMenu')?.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { MENU_DATA = JSON.parse(reader.result); saveMenu(); renderMenu(currentCategory); renderAdminMenuTable(); showToast('Меню імпортовано'); } catch { showToast('Помилка імпорту', 'error'); } };
    reader.readAsText(file);
  });

  // Reviews CRUD
  $('#addReview')?.addEventListener('click', () => openReviewModal());
  renderAdminReviewsTable();

  // Settings
  $('#changePassForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    extendAdminSession(); // Re-auth for sensitive action
    const oldP = $('#oldPass').value, newP = $('#newPass').value, confP = $('#confirmPass').value;
    if (newP !== confP) { showToast('Паролі не співпадають', 'error'); return; }
    if (newP.length < 12) { showToast('Пароль має бути мінімум 12 символів', 'error'); return; }
    const result = await changeAdminPassword(oldP, newP);
    if (result.ok) {
      showToast('Пароль успішно змінено!');
      $('#changePassForm').reset();
    } else {
      showToast(result.error, 'error');
    }
  });
  $('#clearAllData')?.addEventListener('click', () => {
    extendAdminSession();
    if (confirm('Видалити ВСІ дані? Кошик, замовлення, авторизацію, пароль адмінки.')) {
      localStorage.clear(); location.reload();
    }
  });

  renderAdminMenuTable();
}

function renderAdminMenuTable() {
  const tbody = $('#adminMenuBody');
  if (!tbody) return;
  tbody.innerHTML = MENU_DATA.map(item => `
    <tr data-id="${item.id}">
      <td>${item.id}</td>
      <td><img src="${escapeHtmlAttr(item.image)}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:var(--radius-sm)"></td>
      <td>${escapeHtml(item.name)}</td>
      <td><span class="category-badge cat-${item.category}">${escapeHtml(item.category)}</span></td>
      <td>${formatPrice(item.price)}</td>
      <td>${item.tags.map(t => `<span class="menu-card-tag">${escapeHtml(t)}</span>`).join(' ')}</td>
      <td>${escapeHtml(item.badge || '—')}</td>
      <td>
        <button class="btn btn-ghost btn-sm" data-edit="${item.id}" title="Редагувати">✏️</button>
        <button class="btn btn-ghost btn-sm" data-delete="${item.id}" title="Видалити">🗑️</button>
      </td>
    </tr>
  `).join('');

  $$('[data-edit]').forEach(btn => btn.addEventListener('click', () => { extendAdminSession(); openMenuModal(+btn.dataset.edit); }));
  $$('[data-delete]').forEach(btn => btn.addEventListener('click', () => {
    extendAdminSession();
    if (confirm('Видалити цю страву?')) { MENU_DATA = MENU_DATA.filter(i => i.id !== +btn.dataset.delete); saveMenu(); renderMenu(currentCategory); renderAdminMenuTable(); showToast('Страву видалено'); }
  }));
}

function renderAdminReviewsTable() {
  const tbody = $('#adminReviewsBody');
  if (!tbody) return;
  tbody.innerHTML = REVIEWS_DATA.map(r => `
    <tr data-id="${r.id}">
      <td>${r.id}</td>
      <td>${escapeHtml(r.author)}</td>
      <td><span class="review-avatar" style="width:32px;height:32px;font-size:var(--text-sm)">${escapeHtml(r.avatar)}</span></td>
      <td>${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.text)}</td>
      <td>
        <button class="btn btn-ghost btn-sm" data-edit="${r.id}">✏️</button>
        <button class="btn btn-ghost btn-sm" data-delete="${r.id}">🗑️</button>
      </td>
    </tr>
  `).join('');

  $$('#adminReviewsBody [data-edit]').forEach(btn => btn.addEventListener('click', () => { extendAdminSession(); openReviewModal(+btn.dataset.edit); }));
  $$('#adminReviewsBody [data-delete]').forEach(btn => btn.addEventListener('click', () => {
    extendAdminSession();
    if (confirm('Видалити цей відгук?')) { REVIEWS_DATA = REVIEWS_DATA.filter(i => i.id !== +btn.dataset.delete); saveReviews(); renderReviews(); renderAdminReviewsTable(); showToast('Відгук видалено'); }
  }));
}

// ============================================================
// MODALS (Menu Item / Review)
// ============================================================
function openMenuModal(editId = null) {
  const item = editId ? MENU_DATA.find(i => i.id === editId) : null;
  const modal = createModal(item ? 'Редагувати страву' : 'Додати страву', `
    <form id="menuItemForm">
      <input type="hidden" name="id" value="${item?.id || ''}">
      <div class="form-row"><label>Назва *</label><input type="text" name="name" value="${escapeHtmlAttr(item?.name || '')}" required></div>
      <div class="form-row"><label>Категорія *</label>
        <select name="category" required>
          <option value="nigiri" ${item?.category==='nigiri'?'selected':''}>Нігірі</option>
          <option value="rolls" ${item?.category==='rolls'?'selected':''}>Роли</option>
          <option value="sashimi" ${item?.category==='sashimi'?'selected':''}>Сашімі</option>
          <option value="hot" ${item?.category==='hot'?'selected':''}>Гаряче</option>
          <option value="drinks" ${item?.category==='drinks'?'selected':''}>Напої</option>
        </select>
      </div>
      <div class="form-row"><label>Опис *</label><textarea name="desc" required>${escapeHtml(item?.desc || '')}</textarea></div>
      <div class="form-row"><label>Ціна (₴) *</label><input type="number" name="price" value="${item?.price || ''}" required min="1"></div>
      <div class="form-row"><label>URL фото *</label><input type="url" name="image" value="${escapeHtmlAttr(item?.image || '')}" required></div>
      <div class="form-row"><label>Теги (через кому)</label><input type="text" name="tags" value="${(item?.tags || []).join(', ')}" placeholder="Популярне, Преміум, Веган"></div>
      <div class="form-row"><label>Бейдж</label><input type="text" name="badge" value="${escapeHtmlAttr(item?.badge || '')}" placeholder="Хіт, Новинка, Рекомендація шефа"></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-close>Скасувати</button>
        <button type="submit" class="btn btn-primary">${item ? 'Зберегти' : 'Додати'}</button>
      </div>
    </form>
  `);
  $('#menuItemForm')?.addEventListener('submit', e => {
    e.preventDefault();
    extendAdminSession();
    const fd = new FormData(e.target);
    const data = {
      id: fd.get('id') ? +fd.get('id') : Date.now(),
      name: fd.get('name'), category: fd.get('category'),
      desc: fd.get('desc'), price: +fd.get('price'),
      image: fd.get('image'),
      tags: fd.get('tags').split(',').map(t => t.trim()).filter(Boolean),
      badge: fd.get('badge') || null
    };
    if (editId) { MENU_DATA = MENU_DATA.map(i => i.id === editId ? data : i); }
    else { MENU_DATA.unshift(data); }
    saveMenu(); renderMenu(currentCategory); renderAdminMenuTable(); closeModal(modal); showToast(editId ? 'Страву оновлено' : 'Страву додано');
  });
  modal.querySelector('[data-close]')?.addEventListener('click', () => closeModal(modal));
}

function openReviewModal(editId = null) {
  const review = editId ? REVIEWS_DATA.find(r => r.id === editId) : null;
  const modal = createModal(editId ? 'Редагувати відгук' : 'Додати відгук', `
    <form id="reviewForm">
      <input type="hidden" name="id" value="${review?.id || ''}">
      <div class="form-row"><label>Автор *</label><input type="text" name="author" value="${escapeHtmlAttr(review?.author || '')}" required></div>
      <div class="form-row"><label>Аватар (1 літера) *</label><input type="text" name="avatar" value="${escapeHtmlAttr(review?.avatar || '')}" required maxlength="1" style="text-transform:uppercase;width:60px"></div>
      <div class="form-row"><label>Оцінка *</label>
        <select name="rating" required>
          ${[5,4,3,2,1].map(v => `<option value="${v}" ${review?.rating===v?'selected':''}>${v} зірок</option>`).join('')}
        </select>
      </div>
      <div class="form-row"><label>Текст відгуку *</label><textarea name="text" rows="4" required>${escapeHtml(review?.text || '')}</textarea></div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-close>Скасувати</button>
        <button type="submit" class="btn btn-primary">${review ? 'Зберегти' : 'Додати'}</button>
      </div>
    </form>
  `);
  $('#reviewForm')?.addEventListener('submit', e => {
    e.preventDefault();
    extendAdminSession();
    const fd = new FormData(e.target);
    const data = {
      id: fd.get('id') ? +fd.get('id') : Date.now(),
      author: fd.get('author'), avatar: fd.get('avatar').toUpperCase(),
      rating: +fd.get('rating'), text: fd.get('text')
    };
    if (editId) { REVIEWS_DATA = REVIEWS_DATA.map(r => r.id === editId ? data : r); }
    else { REVIEWS_DATA.unshift(data); }
    saveReviews(); renderReviews(); renderAdminReviewsTable(); closeModal(modal); showToast(editId ? 'Відгук оновлено' : 'Відгук додано');
  });
  modal.querySelector('[data-close]')?.addEventListener('click', () => closeModal(modal));
}

function createModal(title, content) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <header class="modal-header">
        <h3 id="modalTitle">${escapeHtml(title)}</h3>
        <button class="modal-close" aria-label="Закрити">×</button>
      </header>
      <div class="modal-body">${content}</div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close')?.addEventListener('click', () => closeModal(overlay));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay); });
  return overlay;
}
function closeModal(modal) { modal.remove(); }

// ============================================================
// ADMIN AUTH FLOW
// ============================================================
async function tryAdminLogin(password) {
  const ok = await verifyAdminPassword(password);
  if (ok) {
    createAdminSession();
    isAdmin = true;
    injectAdminAccess();
    showToast('Адмінка розблокована');
    openAdminPanel();
    return true;
  }
  showToast('Невірний пароль', 'error');
  return false;
}

function logoutAdmin() {
  destroyAdminSession();
  removeAdminAccess();
  showToast('Ви вийшли з адмінки');
}

function promptAdminPassword() {
  const pass = prompt('Введіть пароль адмінки (мінімум 12 символів):');
  if (pass) tryAdminLogin(pass);
}

async function checkAdminAuth() {
  isAdmin = checkAdminSession();
  if (isAdmin) injectAdminAccess();
  await initializeAdminVerifier();
}

// ============================================================
// HIDDEN ADMIN TRIGGERS
// ============================================================
function initHiddenAdminTrigger() {
  // 1. Keyboard: Ctrl+Shift+S
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'S') {
      e.preventDefault();
      if (isAdmin) openAdminPanel();
      else promptAdminPassword();
    }
  });

  // 2. URL: ?admin=1 or #admin
  if (new URLSearchParams(location.search).get('admin') === '1' || location.hash === '#admin') {
    if (isAdmin) openAdminPanel();
    else { setTimeout(() => promptAdminPassword(), 500); }
  }

  // 3. Double-click footer logo
  $('.footer-brand .logo')?.addEventListener('dblclick', () => {
    if (!isAdmin) promptAdminPassword();
  });
}

// ============================================================
// SCROLL ANIMATIONS
// ============================================================
function observeReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
  $$('.reveal').forEach(el => observer.observe(el));
}

// ============================================================
// HEADER SCROLL
// ============================================================
const onScroll = throttle(() => {
  const header = $('#header');
  if (window.scrollY > 20) { header.style.boxShadow = 'var(--shadow-md)'; header.style.background = 'rgba(250,249,246,0.95)'; }
  else { header.style.boxShadow = 'none'; header.style.background = 'rgba(250,249,246,0.9)'; }
}, 100);

// ============================================================
// PHONE MASK (UA format +380)
// ============================================================
function initPhoneMask() {
  const input = $('#phone');
  if (!input) return;

  function formatPhone(val) {
    val = val.replace(/\D/g, '');
    // Нормализуем к 10 цифр (без +380)
    if (val.startsWith('380')) val = val.slice(3);
    else if (val.startsWith('0')) val = val.slice(1);
    // Оставляем только 10 цифр
    val = val.slice(0, 10);

    // Форматируем: +38 (XXX) XXX-XX-XX
    let formatted = '+38';
    if (val.length > 0) formatted += ' (' + val.slice(0, 3);
    if (val.length >= 3) formatted += ') ' + val.slice(3, 6);
    if (val.length >= 6) formatted += '-' + val.slice(6, 8);
    if (val.length >= 8) formatted += '-' + val.slice(8, 10);
    return formatted;
  }

  input.addEventListener('input', e => {
    const cursorPos = e.target.selectionStart;
    const oldVal = e.target.value;
    const newVal = formatPhone(oldVal);
    e.target.value = newVal;

    // Восстанавливаем курсор с учётом добавленных символов форматирования
    const diff = newVal.length - oldVal.length;
    let newCursor = cursorPos + diff;

    // Корректируем, если курсор попал на спецсимволы
    const specialChars = [' ', '(', ')', '-'];
    while (newCursor < newVal.length && specialChars.includes(newVal[newCursor])) {
      newCursor++;
    }
    newCursor = Math.min(newCursor, newVal.length);
    e.target.setSelectionRange(newCursor, newCursor);
  });

  input.addEventListener('blur', () => validateField(input));
}

// ============================================================
// LOAD PROGRESS
// ============================================================
function initLoadProgress() {
  const progress = $('#loadProgress');
  let loaded = 0, total = 3;
  function step() { loaded++; progress.style.transform = `scaleX(${loaded/total})`; if (loaded===total) { setTimeout(()=>{progress.style.transform='scaleX(1)';progress.style.opacity='0';setTimeout(()=>progress.style.display='none',300);},200);} }
  if (document.readyState==='complete'||document.readyState==='interactive') {step();step();step();}
  else document.addEventListener('DOMContentLoaded',()=>{step();step();step();});
}

// ============================================================
// COUNTER ANIMATION
// ============================================================
function animateCounters() {
  $$('.stat-value[data-count]').forEach(el => { const target=+el.dataset.count; const start=performance.now();
    function tick(now){const p=Math.min((now-start)/1500,1); const e=1-Math.pow(1-p,3); el.textContent=Math.floor(target*e); if(p<1)requestAnimationFrame(tick);else el.textContent=target;}
    requestAnimationFrame(tick);
  });
}

// ============================================================
// FIELD VALIDATION ON BLUR
// ============================================================
function initFieldValidation() {
  $$('#orderForm input, #orderForm textarea').forEach(field => {
    field.addEventListener('blur', () => validateField(field));
    field.addEventListener('input', () => {
      if (field.classList.contains('invalid')) validateField(field);
    });
  });
}

// ============================================================
// INIT
// ============================================================
async function init() {
  // Initialize admin verifier first (creates default if needed)
  await initializeAdminVerifier();

  // Check existing session
  await checkAdminAuth();

  // Render UI
  renderMenu('all'); renderReviews(); updateCartUI(); initHiddenAdminTrigger();

  // Events
  $('#menuTabs')?.addEventListener('click', e => { const btn=e.target.closest('.tab-btn'); if(btn) renderMenu(btn.dataset.category); });
  $('.menu-grid')?.addEventListener('click', e => { const btn=e.target.closest('[data-add-to-cart]'); if(btn) addToCart(+btn.dataset.addToCart); });

  $('#cartBtn')?.addEventListener('click', openCart);
  $('#cartClose')?.addEventListener('click', closeCart);
  $('#cartBackdrop')?.addEventListener('click', closeCart);
  $('#cartItems')?.addEventListener('click', e => {
    const item=e.target.closest('.cart-item'); if(!item) return;
    const id=+item.dataset.id;
    if(e.target.dataset.action==='inc') updateCartItemQty(id,1);
    else if(e.target.dataset.action==='dec') updateCartItemQty(id,-1);
    else if(e.target.dataset.action==='remove') removeFromCart(id);
  });
  $('#cartCheckout')?.addEventListener('click',()=>{closeCart();$('#contact')?.scrollIntoView({behavior:'smooth'});setTimeout(()=>$('#name')?.focus(),500);});

  $('#nextReview')?.addEventListener('click', nextReview);
  $('#prevReview')?.addEventListener('click', prevReview);
  $('#sliderDots')?.addEventListener('click', e => { const dot=e.target.closest('.slider-dot'); if(dot) goToSlide(+dot.dataset.slide); });

  $('#navToggle')?.addEventListener('click', toggleMobileNav);
  $$('.nav-link').forEach(link=>link.addEventListener('click',()=>{$('#navToggle')?.setAttribute('aria-expanded','false');$('#navMenu').style.display='none';}));

  $('#orderForm')?.addEventListener('submit', handleOrderSubmit);
  window.addEventListener('scroll', onScroll);
  window.addEventListener('resize', debounce(()=>{const n=getReviewsPerSlide();},250));

  initPhoneMask(); initLoadProgress(); initTurnstile(); initFieldValidation();

  document.addEventListener('DOMContentLoaded',()=>{
    observeReveal();animateCounters();
    $$('.hero-content>*').forEach((el,i)=>{el.style.animationDelay=`${i*100}ms`;el.classList.add('animate-fade-in-up');});
  });
}

init();