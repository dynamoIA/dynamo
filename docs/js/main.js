/* ─── DynamoBot Panel — main.js ────────────────────────────────────── */

'use strict';

/* ════════════════════════════════════════════════════════════════════
   CONFIG
   ════════════════════════════════════════════════════════════════════ */
const CONFIG = {
  // Discord OAuth2 — replace CLIENT_ID if needed
  CLIENT_ID:    '1482032015179255899',
  REDIRECT_URI: 'https://realdrivemultiplayer-droid.github.io/dynamo/',
  SCOPES:       'identify guilds',

  // Storage keys
  STORAGE: {
    TOKEN:   'dynamo_token',
    USER:    'dynamo_user',
    GUILD:   'dynamo_guild',
    CONFIG:  'dynamo_config',
  },
};

/* ════════════════════════════════════════════════════════════════════
   STATE
   ════════════════════════════════════════════════════════════════════ */
const state = {
  user:          null,
  selectedGuild: null,
  config:        {},
  token:         null,
};

/* ════════════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
   ════════════════════════════════════════════════════════════════════ */
const Toast = (() => {
  const container = document.getElementById('toastContainer');

  const ICONS = {
    success: `<svg class="toast__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg class="toast__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info:    `<svg class="toast__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    warning: `<svg class="toast__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  };

  function show(message, type = 'info', duration = 4000) {
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `${ICONS[type] || ICONS.info}<span>${message}</span>`;
    container.appendChild(toast);

    const remove = () => {
      toast.classList.add('toast--exit');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    const timer = setTimeout(remove, duration);
    toast.addEventListener('click', () => { clearTimeout(timer); remove(); });
  }

  return {
    success: (msg, d) => show(msg, 'success', d),
    error:   (msg, d) => show(msg, 'error',   d),
    info:    (msg, d) => show(msg, 'info',    d),
    warning: (msg, d) => show(msg, 'warning', d),
  };
})();

/* ════════════════════════════════════════════════════════════════════
   STORAGE HELPERS
   ════════════════════════════════════════════════════════════════════ */
const Store = {
  get(key)        { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  del(key)        { try { localStorage.removeItem(key); } catch {} },
};

/* ════════════════════════════════════════════════════════════════════
   DISCORD OAUTH2
   ════════════════════════════════════════════════════════════════════ */
const Auth = (() => {

  function buildOAuthURL() {
    const params = new URLSearchParams({
      client_id:     CONFIG.CLIENT_ID,
      redirect_uri:  CONFIG.REDIRECT_URI,
      response_type: 'token',
      scope:         CONFIG.SCOPES,
    });
    return `https://discord.com/api/oauth2/authorize?${params}`;
  }

  function login() {
    window.location.href = buildOAuthURL();
  }

  function logout() {
    Store.del(CONFIG.STORAGE.TOKEN);
    Store.del(CONFIG.STORAGE.USER);
    Store.del(CONFIG.STORAGE.GUILD);
    state.user          = null;
    state.selectedGuild = null;
    state.token         = null;
    UI.showLanding();
    Toast.info('Sesión cerrada correctamente.');
  }

  // Parse token from URL hash after OAuth redirect
  function parseHashToken() {
    const hash   = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const token  = params.get('access_token');
    if (token) {
      // Clean URL
      history.replaceState(null, '', window.location.pathname);
      return token;
    }
    return null;
  }

  async function fetchUser(token) {
    const res = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('No se pudo obtener el usuario.');
    return res.json();
  }

  async function fetchGuilds(token) {
    const res = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('No se pudieron obtener los servidores.');
    return res.json();
  }

  async function init() {
    // 1. Check for fresh OAuth token in URL hash
    const freshToken = parseHashToken();
    if (freshToken) {
      Store.set(CONFIG.STORAGE.TOKEN, freshToken);
    }

    const token = freshToken || Store.get(CONFIG.STORAGE.TOKEN);
    if (!token) return; // Not logged in

    state.token = token;

    try {
      // Try cached user first
      let user = Store.get(CONFIG.STORAGE.USER);
      if (!user) {
        user = await fetchUser(token);
        Store.set(CONFIG.STORAGE.USER, user);
      }
      state.user = user;
      UI.setLoggedIn(user);

      // Check if a guild was previously selected
      const savedGuild = Store.get(CONFIG.STORAGE.GUILD);
      if (savedGuild) {
        state.selectedGuild = savedGuild;
        loadConfig(savedGuild.id);
        UI.showDashboard(savedGuild);
      } else {
        await showServerSelector(token);
      }
    } catch (err) {
      console.error('Auth init error:', err);
      // Token may be expired
      Store.del(CONFIG.STORAGE.TOKEN);
      Store.del(CONFIG.STORAGE.USER);
      Toast.warning('Tu sesión ha expirado. Por favor, vuelve a iniciar sesión.');
    }
  }

  async function showServerSelector(token) {
    UI.showPanel();
    UI.showServerSelector();

    try {
      const guilds = await fetchGuilds(token);
      // Filter: user must be admin (permission bit 0x8) or owner
      const adminGuilds = guilds.filter(g => {
        const perms = BigInt(g.permissions || 0);
        return (perms & BigInt(0x8)) === BigInt(0x8);
      });
      UI.renderServerList(adminGuilds);
    } catch (err) {
      console.error('Guilds fetch error:', err);
      Toast.error('No se pudieron cargar los servidores. Intenta de nuevo.');
      UI.renderServerList([]);
    }
  }

  return { login, logout, init, showServerSelector, fetchGuilds };
})();

/* ════════════════════════════════════════════════════════════════════
   CONFIG PERSISTENCE (localStorage per guild)
   ════════════════════════════════════════════════════════════════════ */
function configKey(guildId) {
  return `${CONFIG.STORAGE.CONFIG}_${guildId}`;
}

function loadConfig(guildId) {
  const saved = Store.get(configKey(guildId)) || {};
  state.config = saved;
  populateForms(saved);
  updateOverview(saved);
}

function saveConfig(guildId, patch) {
  const current = Store.get(configKey(guildId)) || {};
  const updated = { ...current, ...patch };
  Store.set(configKey(guildId), updated);
  state.config = updated;
  updateOverview(updated);
  return updated;
}

/* ════════════════════════════════════════════════════════════════════
   FORM POPULATION
   ════════════════════════════════════════════════════════════════════ */
function populateForms(cfg) {
  // Channels
  setVal('chWelcome', cfg.welcome  || '');
  setVal('chLeave',   cfg.leave    || '');
  setVal('chLevels',  cfg.levels   || '');
  setVal('chLogs',    cfg.logs     || '');
  setVal('chMusic',   cfg.music    || '');

  // Roles
  setVal('roleWelcome', cfg.welcomeRole || '');
  setVal('roleSupport', cfg.supportRole || '');

  // Tickets
  setVal('ticketChannel',  cfg.ticketChannel  || '');
  setVal('ticketCategory', cfg.ticketCategory || '');
  setVal('ticketRole',     cfg.ticketRole     || '');

  // AI
  const aiEnabled = document.getElementById('aiEnabled');
  if (aiEnabled) aiEnabled.checked = !!cfg.aiEnabled;
  setVal('aiChannel', cfg.aiChannel || '');
}

function setVal(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

/* ════════════════════════════════════════════════════════════════════
   OVERVIEW CARDS
   ════════════════════════════════════════════════════════════════════ */
function updateOverview(cfg) {
  setOverviewCard('ovWelcome', cfg.welcome  ? `#${cfg.welcome}` : 'Sin configurar', !!cfg.welcome);
  setOverviewCard('ovTickets', cfg.ticketChannel ? `#${cfg.ticketChannel}` : 'Sin configurar', !!cfg.ticketChannel);
  setOverviewCard('ovLevels',  cfg.levels   ? `#${cfg.levels}`  : 'Sin configurar', !!cfg.levels);
  setOverviewCard('ovLogs',    cfg.logs     ? `#${cfg.logs}`    : 'Sin configurar', !!cfg.logs);
  setOverviewCard('ovMusic',   cfg.music    ? `#${cfg.music}`   : 'Sin configurar', !!cfg.music);
  setOverviewCard('ovAI',      cfg.aiEnabled ? 'Activo' : 'Inactivo', !!cfg.aiEnabled);
}

function setOverviewCard(id, value, active) {
  const valEl    = document.getElementById(`${id}Val`);
  const statusEl = document.getElementById(`${id}Status`);
  if (valEl)    valEl.textContent = value;
  if (statusEl) {
    statusEl.className = `overview-card__status overview-card__status--${active ? 'on' : 'off'}`;
  }
}

/* ════════════════════════════════════════════════════════════════════
   UI CONTROLLER
   ════════════════════════════════════════════════════════════════════ */
const UI = (() => {

  const pageLanding  = document.getElementById('pageLanding');
  const pagePanel    = document.getElementById('pagePanel');
  const serverSel    = document.getElementById('serverSelector');
  const dashLayout   = document.getElementById('dashboardLayout');
  const navbar       = document.getElementById('navbar');

  // Auth elements
  const navLoggedOut = document.getElementById('navLoggedOut');
  const navLoggedIn  = document.getElementById('navLoggedIn');
  const navAvatar    = document.getElementById('navAvatar');
  const navUsername  = document.getElementById('navUsername');
  const panelNav     = document.getElementById('panelNav');
  const mobileLoggedOut = document.getElementById('mobileLoggedOut');
  const mobileLoggedIn  = document.getElementById('mobileLoggedIn');

  function showLanding() {
    pageLanding.style.display = '';
    pagePanel.style.display   = 'none';
    navbar.classList.remove('panel-mode');
    if (panelNav) panelNav.style.display = 'none';
    if (navLoggedOut) navLoggedOut.style.display = '';
    if (navLoggedIn)  navLoggedIn.style.display  = 'none';
    if (mobileLoggedOut) mobileLoggedOut.style.display = '';
    if (mobileLoggedIn)  mobileLoggedIn.style.display  = 'none';
  }

  function showPanel() {
    pageLanding.style.display = 'none';
    pagePanel.style.display   = '';
    navbar.classList.add('panel-mode');
  }

  function showServerSelector() {
    serverSel.style.display  = '';
    dashLayout.style.display = 'none';
    if (panelNav) panelNav.style.display = 'none';
  }

  function showDashboard(guild) {
    serverSel.style.display  = 'none';
    dashLayout.style.display = '';
    if (panelNav) panelNav.style.display = '';

    // Populate sidebar server info
    const icon = document.getElementById('sidebarServerIcon');
    const name = document.getElementById('sidebarServerName');
    const dashName = document.getElementById('dashServerName');

    if (icon) {
      if (guild.icon) {
        icon.src = `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`;
        icon.alt = guild.name;
      } else {
        icon.src = '';
        icon.alt = '';
      }
    }
    if (name)     name.textContent     = guild.name;
    if (dashName) dashName.textContent = guild.name;

    // Show dashboard section by default
    switchSection('dashboard');
  }

  function setLoggedIn(user) {
    if (navLoggedOut) navLoggedOut.style.display = 'none';
    if (navLoggedIn)  navLoggedIn.style.display  = '';
    if (mobileLoggedOut) mobileLoggedOut.style.display = 'none';
    if (mobileLoggedIn)  mobileLoggedIn.style.display  = '';

    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || '0') % 5}.png`;

    if (navAvatar)   { navAvatar.src = avatarUrl; navAvatar.alt = user.username; }
    if (navUsername) navUsername.textContent = user.global_name || user.username;

    const sidebarAvatar   = document.getElementById('sidebarAvatar');
    const sidebarUsername = document.getElementById('sidebarUsername');
    if (sidebarAvatar)   { sidebarAvatar.src = avatarUrl; sidebarAvatar.alt = user.username; }
    if (sidebarUsername) sidebarUsername.textContent = user.global_name || user.username;
  }

  function renderServerList(guilds) {
    const list = document.getElementById('serverList');
    if (!list) return;

    if (!guilds || guilds.length === 0) {
      list.innerHTML = `
        <div class="server-list__empty">
          <strong>No se encontraron servidores</strong>
          Asegúrate de que DynamoBot está en el servidor y tienes permisos de administrador.
        </div>`;
      return;
    }

    list.innerHTML = guilds.map(g => {
      const iconHtml = g.icon
        ? `<img src="https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64" alt="${escapeHtml(g.name)}" />`
        : `<span>${escapeHtml(g.name.charAt(0).toUpperCase())}</span>`;

      return `
        <button class="server-item" data-guild='${JSON.stringify({ id: g.id, name: g.name, icon: g.icon || null })}'>
          <div class="server-item__icon">${iconHtml}</div>
          <div class="server-item__info">
            <div class="server-item__name">${escapeHtml(g.name)}</div>
            <div class="server-item__meta">ID: ${g.id}</div>
          </div>
          <svg class="server-item__arrow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
        </button>`;
    }).join('');

    // Attach click handlers
    list.querySelectorAll('.server-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const guild = JSON.parse(btn.dataset.guild);
        selectGuild(guild);
      });
    });
  }

  function switchSection(name) {
    const sections = {
      dashboard: 'sectionDashboard',
      channels:  'sectionChannels',
      roles:     'sectionRoles',
      tickets:   'sectionTickets',
      ai:        'sectionAi',
    };

    Object.entries(sections).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.style.display = key === name ? '' : 'none';
    });

    // Update sidebar active state
    document.querySelectorAll('.sidebar__nav-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === name);
    });

    // Update navbar tabs active state
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.section === name);
    });
  }

  return { showLanding, showPanel, showServerSelector, showDashboard, setLoggedIn, renderServerList, switchSection };
})();

/* ════════════════════════════════════════════════════════════════════
   GUILD SELECTION
   ════════════════════════════════════════════════════════════════════ */
function selectGuild(guild) {
  state.selectedGuild = guild;
  Store.set(CONFIG.STORAGE.GUILD, guild);
  loadConfig(guild.id);
  UI.showDashboard(guild);
  Toast.success(`Servidor "${guild.name}" seleccionado.`);
}

/* ════════════════════════════════════════════════════════════════════
   SAVE HANDLERS
   ════════════════════════════════════════════════════════════════════ */
function withLoader(fn) {
  return async function (...args) {
    const loader = document.getElementById('contentLoader');
    if (loader) loader.style.display = '';
    try {
      await fn(...args);
    } finally {
      if (loader) loader.style.display = 'none';
    }
  };
}

function validateChannelName(value) {
  if (!value) return true; // empty is OK (means "not set")
  return /^[a-z0-9\-_]+$/.test(value);
}

function validateRoleName(value) {
  if (!value) return true;
  return value.length >= 1 && value.length <= 100;
}

const saveChannels = withLoader(async () => {
  const data = {
    welcome: getVal('chWelcome'),
    leave:   getVal('chLeave'),
    levels:  getVal('chLevels'),
    logs:    getVal('chLogs'),
    music:   getVal('chMusic'),
  };

  // Validate
  for (const [key, val] of Object.entries(data)) {
    if (!validateChannelName(val)) {
      Toast.error(`El nombre del canal "${val}" no es válido. Usa solo letras minúsculas, números, guiones y guiones bajos.`);
      return;
    }
  }

  await simulateSave();
  saveConfig(state.selectedGuild.id, data);
  Toast.success('Canales guardados correctamente.');
});

const saveRoles = withLoader(async () => {
  const data = {
    welcomeRole: getVal('roleWelcome'),
    supportRole: getVal('roleSupport'),
  };

  for (const [key, val] of Object.entries(data)) {
    if (!validateRoleName(val)) {
      Toast.error(`El nombre del rol "${val}" no es válido.`);
      return;
    }
  }

  await simulateSave();
  saveConfig(state.selectedGuild.id, data);
  Toast.success('Roles guardados correctamente.');
});

const saveTickets = withLoader(async () => {
  const data = {
    ticketChannel:  getVal('ticketChannel'),
    ticketCategory: getVal('ticketCategory'),
    ticketRole:     getVal('ticketRole'),
  };

  if (data.ticketChannel && !validateChannelName(data.ticketChannel)) {
    Toast.error('El nombre del canal de tickets no es válido.');
    return;
  }

  await simulateSave();
  saveConfig(state.selectedGuild.id, data);
  Toast.success('Configuración de tickets guardada.');
});

const saveAi = withLoader(async () => {
  const aiEnabled = document.getElementById('aiEnabled');
  const data = {
    aiEnabled: aiEnabled ? aiEnabled.checked : false,
    aiChannel: getVal('aiChannel'),
  };

  await simulateSave();
  saveConfig(state.selectedGuild.id, data);
  Toast.success(data.aiEnabled ? 'Asistente de IA activado.' : 'Asistente de IA desactivado.');
});

// Simulate async save (replace with real API call when backend is ready)
function simulateSave() {
  return new Promise(resolve => setTimeout(resolve, 600));
}

/* ════════════════════════════════════════════════════════════════════
   UTILITY
   ════════════════════════════════════════════════════════════════════ */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ════════════════════════════════════════════════════════════════════
   NAVBAR SCROLL EFFECT
   ════════════════════════════════════════════════════════════════════ */
(function initNavbar() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;

  function onScroll() {
    if (window.scrollY > 20) {
      navbar.classList.add('scrolled');
    } else {
      navbar.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ════════════════════════════════════════════════════════════════════
   MOBILE MENU
   ════════════════════════════════════════════════════════════════════ */
(function initMobileMenu() {
  const btn       = document.getElementById('menuBtn');
  const menu      = document.getElementById('mobileMenu');
  const iconOpen  = document.getElementById('menuIconOpen');
  const iconClose = document.getElementById('menuIconClose');
  if (!btn || !menu) return;

  function openMenu() {
    menu.classList.add('open');
    if (iconOpen)  iconOpen.style.display  = 'none';
    if (iconClose) iconClose.style.display = 'block';
    btn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    menu.classList.remove('open');
    if (iconOpen)  iconOpen.style.display  = 'block';
    if (iconClose) iconClose.style.display = 'none';
    btn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  btn.addEventListener('click', () => {
    menu.classList.contains('open') ? closeMenu() : openMenu();
  });

  menu.querySelectorAll('a, button').forEach(el => {
    el.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && !btn.contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
  });
})();

/* ════════════════════════════════════════════════════════════════════
   SCROLL REVEAL
   ════════════════════════════════════════════════════════════════════ */
(function initReveal() {
  const elements = document.querySelectorAll('.reveal');
  if (!elements.length) return;

  if ('IntersectionObserver' in window) {
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
  } else {
    elements.forEach(el => el.classList.add('visible'));
  }
})();

/* ════════════════════════════════════════════════════════════════════
   EVENT LISTENERS
   ════════════════════════════════════════════════════════════════════ */
function initEventListeners() {

  // ── Login buttons ──
  const loginTriggers = ['loginBtn', 'heroLoginBtn', 'mobileLoginBtn', 'footerLoginLink'];
  loginTriggers.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', e => { e.preventDefault(); Auth.login(); });
  });

  // ── Logout ──
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', Auth.logout);

  // ── Sidebar navigation ──
  document.querySelectorAll('.sidebar__nav-item[data-section]').forEach(btn => {
    btn.addEventListener('click', () => UI.switchSection(btn.dataset.section));
  });

  // ── Navbar panel tabs ──
  document.querySelectorAll('.nav-tab[data-section]').forEach(btn => {
    btn.addEventListener('click', () => UI.switchSection(btn.dataset.section));
  });

  // ── Mobile nav tabs ──
  document.querySelectorAll('.mobile-nav-tab[data-section]').forEach(btn => {
    btn.addEventListener('click', () => UI.switchSection(btn.dataset.section));
  });

  // ── Change server ──
  const changeServerBtn = document.getElementById('changeServerBtn');
  if (changeServerBtn) {
    changeServerBtn.addEventListener('click', async () => {
      Store.del(CONFIG.STORAGE.GUILD);
      state.selectedGuild = null;
      UI.showServerSelector();
      if (state.token) {
        await Auth.showServerSelector(state.token);
      }
    });
  }

  // ── Save buttons ──
  const saveChannelsBtn = document.getElementById('saveChannelsBtn');
  if (saveChannelsBtn) saveChannelsBtn.addEventListener('click', saveChannels);

  const saveRolesBtn = document.getElementById('saveRolesBtn');
  if (saveRolesBtn) saveRolesBtn.addEventListener('click', saveRoles);

  const saveTicketsBtn = document.getElementById('saveTicketsBtn');
  if (saveTicketsBtn) saveTicketsBtn.addEventListener('click', saveTickets);

  const saveAiBtn = document.getElementById('saveAiBtn');
  if (saveAiBtn) saveAiBtn.addEventListener('click', saveAi);

  // ── Keyboard save shortcut (Ctrl/Cmd + S) ──
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (!state.selectedGuild) return;

      // Determine active section and save
      const active = document.querySelector('.sidebar__nav-item.active');
      if (!active) return;
      const section = active.dataset.section;
      if (section === 'channels') saveChannels();
      else if (section === 'roles')   saveRoles();
      else if (section === 'tickets') saveTickets();
      else if (section === 'ai')      saveAi();
    }
  });

  // ── AI toggle shows/hides channel field ──
  const aiEnabled = document.getElementById('aiEnabled');
  const aiChannelGroup = document.getElementById('aiChannelGroup');
  if (aiEnabled && aiChannelGroup) {
    aiEnabled.addEventListener('change', () => {
      aiChannelGroup.style.opacity = aiEnabled.checked ? '1' : '0.5';
    });
  }
}

/* ════════════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  Auth.init();
});
