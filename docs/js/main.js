/* ─── DynamoBot — main.js ──────────────────────────────────────────── */
/* Modular, scalable architecture with robust error handling            */

'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Lightweight logger — set LOG_LEVEL to 'none' in production to silence.
 * Levels: debug < info < warn < error < none
 */
const Logger = (() => {
  const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };
  const current = LEVELS['info'];
  const prefix  = '[DynamoBot]';

  return {
    debug : (...a) => current <= LEVELS.debug  && console.debug(prefix, ...a),
    info  : (...a) => current <= LEVELS.info   && console.info (prefix, ...a),
    warn  : (...a) => current <= LEVELS.warn   && console.warn (prefix, ...a),
    error : (...a) => current <= LEVELS.error  && console.error(prefix, ...a),
  };
})();

/**
 * Debounce — delays fn execution until after `wait` ms of inactivity.
 * @param {Function} fn
 * @param {number}   wait  milliseconds
 * @returns {Function}
 */
function debounce(fn, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Throttle — ensures fn is called at most once per `limit` ms.
 * @param {Function} fn
 * @param {number}   limit  milliseconds
 * @returns {Function}
 */
function throttle(fn, limit) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= limit) {
      last = now;
      fn.apply(this, args);
    }
  };
}

/**
 * Sanitize a string for safe HTML insertion.
 * Prevents XSS when rendering user-supplied or API data.
 * @param {string} str
 * @returns {string}
 */
function sanitizeHTML(str) {
  if (typeof str !== 'string') return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return str.replace(/[&<>"']/g, ch => map[ch]);
}

/**
 * Safe JSON parse — returns fallback on any error.
 * @param {string} raw
 * @param {*}      fallback
 * @returns {*}
 */
function safeJSON(raw, fallback = null) {
  try { return JSON.parse(raw); }
  catch { return fallback; }
}

/* ═══════════════════════════════════════════════════════════════════════
   STORAGE — localStorage wrapper with size guard & TTL
   ═══════════════════════════════════════════════════════════════════════ */

const Storage = (() => {
  const MAX_BYTES = 4 * 1024 * 1024; // 4 MB guard

  function _key(k) { return `dynamo:${k}`; }

  function _sizeOf(str) { return new Blob([str]).size; }

  function _prune() {
    // Remove oldest dynamo: entries until under limit
    const keys = Object.keys(localStorage)
      .filter(k => k.startsWith('dynamo:'))
      .map(k => {
        const raw = localStorage.getItem(k);
        const obj = safeJSON(raw, {});
        return { k, ts: obj._ts || 0 };
      })
      .sort((a, b) => a.ts - b.ts);

    for (const { k } of keys) {
      localStorage.removeItem(k);
      Logger.warn('Storage: pruned', k);
      if (_totalSize() < MAX_BYTES * 0.8) break;
    }
  }

  function _totalSize() {
    return Object.keys(localStorage)
      .filter(k => k.startsWith('dynamo:'))
      .reduce((acc, k) => acc + _sizeOf(localStorage.getItem(k) || ''), 0);
  }

  return {
    /**
     * @param {string} key
     * @param {*}      value
     * @param {number} [ttlMs]  optional TTL in milliseconds
     */
    set(key, value, ttlMs) {
      const payload = JSON.stringify({
        v   : value,
        _ts : Date.now(),
        _exp: ttlMs ? Date.now() + ttlMs : null,
      });

      if (_sizeOf(payload) + _totalSize() > MAX_BYTES) {
        _prune();
      }

      try {
        localStorage.setItem(_key(key), payload);
      } catch (e) {
        Logger.error('Storage.set failed:', e);
        _prune();
        try { localStorage.setItem(_key(key), payload); } catch { /* give up */ }
      }
    },

    /**
     * @param {string} key
     * @param {*}      [fallback]
     * @returns {*}
     */
    get(key, fallback = null) {
      const raw = localStorage.getItem(_key(key));
      if (!raw) return fallback;

      const obj = safeJSON(raw, null);
      if (!obj) return fallback;

      if (obj._exp && Date.now() > obj._exp) {
        localStorage.removeItem(_key(key));
        return fallback;
      }

      return obj.v ?? fallback;
    },

    remove(key) {
      localStorage.removeItem(_key(key));
    },

    clear() {
      Object.keys(localStorage)
        .filter(k => k.startsWith('dynamo:'))
        .forEach(k => localStorage.removeItem(k));
    },
  };
})();

/* ═══════════════════════════════════════════════════════════════════════
   HTTP CLIENT — fetch wrapper with timeout, retries & error handling
   ═══════════════════════════════════════════════════════════════════════ */

const Http = (() => {
  const DEFAULT_TIMEOUT = 10_000; // 10 s
  const DEFAULT_RETRIES = 2;

  /**
   * Fetch with timeout.
   * @param {string}  url
   * @param {object}  opts  fetch options
   * @param {number}  ms    timeout in ms
   * @returns {Promise<Response>}
   */
  async function fetchWithTimeout(url, opts = {}, ms = DEFAULT_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);

    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      return res;
    } finally {
      clearTimeout(id);
    }
  }

  /**
   * Fetch with automatic retries on network errors or 5xx responses.
   * @param {string}  url
   * @param {object}  [opts]
   * @param {object}  [cfg]
   * @param {number}  [cfg.timeout]
   * @param {number}  [cfg.retries]
   * @param {number}  [cfg.retryDelay]  base delay ms (doubles each retry)
   * @returns {Promise<{ ok: boolean, status: number, data: * }>}
   */
  async function request(url, opts = {}, cfg = {}) {
    const timeout    = cfg.timeout    ?? DEFAULT_TIMEOUT;
    const retries    = cfg.retries    ?? DEFAULT_RETRIES;
    const retryDelay = cfg.retryDelay ?? 500;

    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchWithTimeout(url, opts, timeout);

        // Parse body
        const contentType = res.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
          ? await res.json().catch(() => null)
          : await res.text().catch(() => null);

        if (!res.ok && res.status >= 500 && attempt < retries) {
          // Retry on server errors
          await _sleep(retryDelay * Math.pow(2, attempt));
          continue;
        }

        return { ok: res.ok, status: res.status, data };

      } catch (err) {
        lastError = err;

        if (err.name === 'AbortError') {
          Logger.warn(`Http: timeout on ${url}`);
          return { ok: false, status: 0, data: null, error: 'timeout' };
        }

        if (attempt < retries) {
          Logger.warn(`Http: retry ${attempt + 1}/${retries} for ${url}`);
          await _sleep(retryDelay * Math.pow(2, attempt));
        }
      }
    }

    Logger.error('Http: request failed after retries:', url, lastError);
    return { ok: false, status: 0, data: null, error: lastError?.message || 'network_error' };
  }

  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return { request };
})();

/* ═══════════════════════════════════════════════════════════════════════
   TOAST — non-blocking notification system
   ═══════════════════════════════════════════════════════════════════════ */

const Toast = (() => {
  let container = null;

  const ICONS = {
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error  : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info   : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };

  const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

  function _getContainer() {
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'false');
      document.body.appendChild(container);
    }
    return container;
  }

  function _dismiss(el) {
    el.classList.add('toast--exit');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }

  /**
   * Show a toast notification.
   * @param {object} opts
   * @param {'success'|'error'|'warning'|'info'} opts.type
   * @param {string}  opts.title
   * @param {string}  [opts.message]
   * @param {number}  [opts.duration]  ms before auto-dismiss (0 = sticky)
   */
  function show({ type = 'info', title, message = '', duration = 4000 }) {
    const c   = _getContainer();
    const el  = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.setAttribute('role', 'alert');

    el.innerHTML = `
      <span class="toast__icon" aria-hidden="true">${ICONS[type] || ICONS.info}</span>
      <div class="toast__body">
        <div class="toast__title">${sanitizeHTML(title)}</div>
        ${message ? `<div class="toast__message">${sanitizeHTML(message)}</div>` : ''}
      </div>
      <button class="toast__close" aria-label="Cerrar notificación">${CLOSE_ICON}</button>
    `;

    el.querySelector('.toast__close').addEventListener('click', () => _dismiss(el));
    c.appendChild(el);

    if (duration > 0) {
      setTimeout(() => _dismiss(el), duration);
    }
  }

  return {
    success: (title, message, duration) => show({ type: 'success', title, message, duration }),
    error  : (title, message, duration) => show({ type: 'error',   title, message, duration }),
    warning: (title, message, duration) => show({ type: 'warning', title, message, duration }),
    info   : (title, message, duration) => show({ type: 'info',    title, message, duration }),
  };
})();

/* ═══════════════════════════════════════════════════════════════════════
   CACHE — in-memory cache with TTL to avoid redundant fetches
   ═══════════════════════════════════════════════════════════════════════ */

const Cache = (() => {
  const store = new Map();

  return {
    /**
     * @param {string} key
     * @param {*}      value
     * @param {number} ttlMs
     */
    set(key, value, ttlMs = 60_000) {
      store.set(key, { value, exp: Date.now() + ttlMs });
    },

    /**
     * @param {string} key
     * @returns {* | undefined}  undefined on miss or expiry
     */
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.exp) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },

    has(key) { return this.get(key) !== undefined; },

    delete(key) { store.delete(key); },

    clear() { store.clear(); },
  };
})();

/* ═══════════════════════════════════════════════════════════════════════
   NAVBAR — scroll effect & active link tracking
   ═══════════════════════════════════════════════════════════════════════ */

(function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  // Scroll effect — throttled for performance
  const onScroll = throttle(() => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  }, 50);

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Active nav link tracking
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.navbar__nav a[href^="#"]');

  if (sections.length && navLinks.length) {
    const updateActive = throttle(() => {
      const scrollY = window.scrollY + 100;

      let activeId = null;
      sections.forEach(section => {
        if (scrollY >= section.offsetTop && scrollY < section.offsetTop + section.offsetHeight) {
          activeId = section.id;
        }
      });

      navLinks.forEach(link => {
        const isActive = link.getAttribute('href') === `#${activeId}`;
        link.classList.toggle('active', isActive);
      });
    }, 80);

    window.addEventListener('scroll', updateActive, { passive: true });
    updateActive();
  }
})();

/* ═══════════════════════════════════════════════════════════════════════
   MOBILE MENU
   ═══════════════════════════════════════════════════════════════════════ */

(function initMobileMenu() {
  const btn       = document.getElementById('menuBtn');
  const menu      = document.getElementById('mobileMenu');
  const iconOpen  = document.getElementById('menuIconOpen');
  const iconClose = document.getElementById('menuIconClose');

  if (!btn || !menu) return;

  let isOpen = false;

  function openMenu() {
    isOpen = true;
    menu.classList.add('open');
    if (iconOpen)  iconOpen.style.display  = 'none';
    if (iconClose) iconClose.style.display = 'block';
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-label', 'Cerrar menú');
    document.body.style.overflow = 'hidden';
    Logger.debug('Mobile menu opened');
  }

  function closeMenu() {
    isOpen = false;
    menu.classList.remove('open');
    if (iconOpen)  iconOpen.style.display  = 'block';
    if (iconClose) iconClose.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Abrir menú');
    document.body.style.overflow = '';
  }

  btn.addEventListener('click', () => isOpen ? closeMenu() : openMenu());

  // Close on any link click inside menu
  menu.addEventListener('click', e => {
    if (e.target.closest('a')) closeMenu();
  });

  // Close on outside click (event delegation on document)
  document.addEventListener('click', e => {
    if (isOpen && !menu.contains(e.target) && !btn.contains(e.target)) {
      closeMenu();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen) closeMenu();
  });
})();

/* ═══════════════════════════════════════════════════════════════════════
   SMOOTH SCROLL — anchor links with navbar offset
   ═══════════════════════════════════════════════════════════════════════ */

(function initSmoothScroll() {
  // Event delegation — one listener for all anchor clicks
  document.addEventListener('click', e => {
    const anchor = e.target.closest('a[href^="#"]');
    if (!anchor) return;

    const targetId = anchor.getAttribute('href');
    if (targetId === '#') return;

    const target = document.querySelector(targetId);
    if (!target) return;

    e.preventDefault();

    const navbarHeight = document.getElementById('navbar')?.offsetHeight ?? 68;
    const top = target.getBoundingClientRect().top + window.scrollY - navbarHeight - 16;

    window.scrollTo({ top, behavior: 'smooth' });
  });
})();

/* ═══════════════════════════════════════════════════════════════════════
   SCROLL REVEAL — IntersectionObserver-based entrance animations
   ═══════════════════════════════════════════════════════════════════════ */

(function initReveal() {
  const elements = document.querySelectorAll('.reveal');
  if (!elements.length) return;

  // Respect prefers-reduced-motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elements.forEach(el => el.classList.add('visible'));
    return;
  }

  if (!('IntersectionObserver' in window)) {
    elements.forEach(el => el.classList.add('visible'));
    return;
  }

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  elements.forEach(el => observer.observe(el));
})();

/* ═══════════════════════════════════════════════════════════════════════
   STAT COUNTERS — animated number roll-up on scroll into view
   ═══════════════════════════════════════════════════════════════════════ */

(function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  // Skip animation if reduced motion is preferred
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  function animateCounter(el) {
    const target   = parseFloat(el.dataset.count);
    const suffix   = el.dataset.suffix  || '';
    const prefix   = el.dataset.prefix  || '';
    const decimals = el.dataset.decimals ? parseInt(el.dataset.decimals, 10) : 0;
    const duration = 1800;
    const start    = performance.now();

    // Guard: skip if target is not a valid number
    if (isNaN(target)) return;

    function update(now) {
      const elapsed  = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const value    = target * easeOutQuart(progress);

      el.textContent = prefix + value.toFixed(decimals) + suffix;

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        el.textContent = prefix + target.toFixed(decimals) + suffix;
      }
    }

    requestAnimationFrame(update);
  }

  if (!('IntersectionObserver' in window)) {
    counters.forEach(animateCounter);
    return;
  }

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCounter(entry.target);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );

  counters.forEach(el => observer.observe(el));
})();

/* ═══════════════════════════════════════════════════════════════════════
   FOOTER — dynamic year
   ═══════════════════════════════════════════════════════════════════════ */

(function initFooterYear() {
  const el = document.getElementById('year');
  if (el) el.textContent = new Date().getFullYear();
})();

/* ═══════════════════════════════════════════════════════════════════════
   MULTI-SERVER SUPPORT — isolated per-server state management
   Each server gets its own namespace in Storage to prevent conflicts.
   ═══════════════════════════════════════════════════════════════════════ */

const ServerManager = (() => {
  const CACHE_TTL   = 5 * 60 * 1000;  // 5 min in-memory cache
  const STORAGE_TTL = 30 * 60 * 1000; // 30 min localStorage TTL

  // In-flight request deduplication: key → Promise
  const _inflight = new Map();

  /**
   * Fetch server data with deduplication, in-memory cache, and localStorage fallback.
   * @param {string} serverId
   * @param {string} apiBase   base URL of the API
   * @param {string} token     auth token
   * @returns {Promise<object|null>}
   */
  async function fetchServer(serverId, apiBase, token) {
    if (!serverId || !apiBase) {
      Logger.warn('ServerManager.fetchServer: missing serverId or apiBase');
      return null;
    }

    const cacheKey = `server:${serverId}`;

    // 1. In-memory cache hit
    const cached = Cache.get(cacheKey);
    if (cached) {
      Logger.debug('ServerManager: cache hit for', serverId);
      return cached;
    }

    // 2. Deduplicate concurrent requests for the same server
    if (_inflight.has(cacheKey)) {
      Logger.debug('ServerManager: deduplicating request for', serverId);
      return _inflight.get(cacheKey);
    }

    // 3. Kick off fetch
    const promise = _doFetch(serverId, apiBase, token, cacheKey);
    _inflight.set(cacheKey, promise);

    try {
      return await promise;
    } finally {
      _inflight.delete(cacheKey);
    }
  }

  async function _doFetch(serverId, apiBase, token, cacheKey) {
    // Check localStorage before hitting the network
    const stored = Storage.get(cacheKey);
    if (stored) {
      Cache.set(cacheKey, stored, CACHE_TTL);
      Logger.debug('ServerManager: localStorage hit for', serverId);
      return stored;
    }

    const url  = `${apiBase}/servers/${encodeURIComponent(serverId)}`;
    const opts = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type' : 'application/json',
      },
    };

    const { ok, status, data, error } = await Http.request(url, opts, { timeout: 10_000, retries: 2 });

    if (!ok) {
      if (status === 401 || status === 403) {
        Logger.warn('ServerManager: auth error for server', serverId, status);
        // Clear stale token
        Storage.remove('auth:token');
        return null;
      }
      Logger.error('ServerManager: fetch failed for', serverId, status, error);
      return null;
    }

    // Validate response shape
    if (!data || typeof data !== 'object') {
      Logger.warn('ServerManager: invalid response for', serverId);
      return null;
    }

    // Populate caches
    Cache.set(cacheKey, data, CACHE_TTL);
    Storage.set(cacheKey, data, STORAGE_TTL);

    Logger.info('ServerManager: fetched server', serverId);
    return data;
  }

  /**
   * Invalidate all caches for a specific server.
   * @param {string} serverId
   */
  function invalidate(serverId) {
    const cacheKey = `server:${serverId}`;
    Cache.delete(cacheKey);
    Storage.remove(cacheKey);
    Logger.info('ServerManager: invalidated', serverId);
  }

  /**
   * Invalidate all server caches.
   */
  function invalidateAll() {
    Cache.clear();
    Storage.clear();
    Logger.info('ServerManager: all caches cleared');
  }

  return { fetchServer, invalidate, invalidateAll };
})();

/* ═══════════════════════════════════════════════════════════════════════
   AUTH — token management with expiry detection
   ═══════════════════════════════════════════════════════════════════════ */

const Auth = (() => {
  const TOKEN_KEY   = 'auth:token';
  const TOKEN_TTL   = 24 * 60 * 60 * 1000; // 24 h

  function getToken() {
    return Storage.get(TOKEN_KEY);
  }

  function setToken(token) {
    if (!token || typeof token !== 'string') {
      Logger.warn('Auth.setToken: invalid token');
      return;
    }
    Storage.set(TOKEN_KEY, token, TOKEN_TTL);
    Logger.info('Auth: token stored');
  }

  function clearToken() {
    Storage.remove(TOKEN_KEY);
    Logger.info('Auth: token cleared');
  }

  function isAuthenticated() {
    return Boolean(getToken());
  }

  return { getToken, setToken, clearToken, isAuthenticated };
})();

/* ═══════════════════════════════════════════════════════════════════════
   RATE LIMITER — local client-side rate limiting to prevent API abuse
   ═══════════════════════════════════════════════════════════════════════ */

const RateLimiter = (() => {
  // key → { count, resetAt }
  const buckets = new Map();

  /**
   * Check if an action is allowed under the rate limit.
   * @param {string} key      action identifier
   * @param {number} limit    max calls per window
   * @param {number} windowMs window duration in ms
   * @returns {boolean}  true if allowed, false if rate-limited
   */
  function allow(key, limit = 10, windowMs = 60_000) {
    const now    = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    if (bucket.count >= limit) {
      Logger.warn(`RateLimiter: limit reached for "${key}"`);
      return false;
    }

    bucket.count++;
    return true;
  }

  return { allow };
})();

/* ═══════════════════════════════════════════════════════════════════════
   INIT — wire everything up after DOM is ready
   ═══════════════════════════════════════════════════════════════════════ */

(function init() {
  Logger.info('DynamoBot panel initialised');

  // Expose utilities on window for debugging in dev tools
  if (typeof window !== 'undefined') {
    window.__dynamo = { Logger, Storage, Cache, Http, Toast, Auth, ServerManager, RateLimiter };
  }
})();
