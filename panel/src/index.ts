import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { cookie } from "@elysiajs/cookie";
import { cors } from "@elysiajs/cors";
import postgres from "postgres";

// ─── Environment ─────────────────────────────────────────────────────────────
const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID     ?? "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? "";
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI  ?? "https://dynamo-panel.up.railway.app/auth/callback";
const DATABASE_URL          = process.env.DATABASE_URL          ?? "";
const JWT_SECRET            = process.env.JWT_SECRET            ?? "dynamo-super-secret-change-me";
const PORT                  = Number(process.env.PORT ?? 3000);

const DISCORD_OAUTH_URL =
  `https://discord.com/api/oauth2/authorize` +
  `?client_id=${DISCORD_CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=identify%20guilds`;

// ─── Database ─────────────────────────────────────────────────────────────────
const sql = postgres(DATABASE_URL, { ssl: { rejectUnauthorized: false } });

async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS guild_configs (
      guild_id            TEXT PRIMARY KEY,
      welcome_channel_id  TEXT,
      exit_channel_id     TEXT,
      ticket_channel_id   TEXT,
      levels_channel_id   TEXT,
      logs_channel_id     TEXT,
      music_channel_id    TEXT,
      autorole_id         TEXT,
      ticket_category_id  TEXT,
      ticket_staff_roles  TEXT,
      mod_role_id         TEXT,
      ia_enabled          INTEGER DEFAULT 0,
      updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  console.log("[DB] Tablas verificadas.");
}

async function getGuildConfig(guildId: string) {
  const rows = await sql`
    SELECT * FROM guild_configs WHERE guild_id = ${guildId}
  `;
  return rows[0] ?? null;
}

async function upsertGuildConfig(guildId: string, data: Record<string, string | number | null>) {
  const allowed = [
    "welcome_channel_id", "exit_channel_id", "ticket_channel_id",
    "levels_channel_id", "logs_channel_id", "music_channel_id",
    "autorole_id", "ticket_category_id", "ticket_staff_roles",
    "mod_role_id", "ia_enabled",
  ];

  // Ensure row exists
  await sql`
    INSERT INTO guild_configs (guild_id) VALUES (${guildId})
    ON CONFLICT (guild_id) DO NOTHING
  `;

  for (const [key, value] of Object.entries(data)) {
    if (!allowed.includes(key)) continue;
    // Dynamic column update — safe because key is validated against allowlist
    await sql`
      UPDATE guild_configs
      SET updated_at = CURRENT_TIMESTAMP
      WHERE guild_id = ${guildId}
    `;
    // Use tagged template with identifier
    await sql`
      UPDATE guild_configs
      SET ${sql(key)} = ${value as string}, updated_at = CURRENT_TIMESTAMP
      WHERE guild_id = ${guildId}
    `;
  }
}

// ─── Discord OAuth helpers ────────────────────────────────────────────────────
interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string;
  avatar?: string;
}

interface DiscordGuild {
  id: string;
  name: string;
  icon?: string;
  permissions: string;
}

async function exchangeCode(code: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id:     DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type:    "authorization_code",
    code,
    redirect_uri:  DISCORD_REDIRECT_URI,
  });

  const res = await fetch("https://discord.com/api/oauth2/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Discord token exchange failed: ${err}`);
  }

  return res.json() as Promise<DiscordTokenResponse>;
}

async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch Discord user");
  return res.json() as Promise<DiscordUser>;
}

async function fetchDiscordGuilds(accessToken: string): Promise<DiscordGuild[]> {
  const res = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch Discord guilds");
  return res.json() as Promise<DiscordGuild[]>;
}

function avatarUrl(user: DiscordUser): string {
  if (!user.avatar) return `https://cdn.discordapp.com/embed/avatars/0.png`;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

// Admin guilds: MANAGE_GUILD permission bit = 0x20
function isAdmin(permissions: string): boolean {
  return (BigInt(permissions) & BigInt(0x20)) !== BigInt(0);
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #0d1117;
    --surface:   #161b22;
    --surface2:  #21262d;
    --border:    #30363d;
    --accent:    #5865f2;
    --accent-h:  #4752c4;
    --green:     #3ba55c;
    --red:       #ed4245;
    --text:      #e6edf3;
    --muted:     #8b949e;
    --radius:    10px;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }

  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* ── Navbar ── */
  .navbar {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 0 2rem;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .navbar-brand {
    display: flex;
    align-items: center;
    gap: .6rem;
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text);
    text-decoration: none;
  }
  .navbar-brand .logo { font-size: 1.5rem; }
  .navbar-user {
    display: flex;
    align-items: center;
    gap: .75rem;
    font-size: .9rem;
    color: var(--muted);
  }
  .navbar-user img {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 2px solid var(--border);
  }
  .navbar-user .username { color: var(--text); font-weight: 600; }

  /* ── Buttons ── */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: .5rem;
    padding: .55rem 1.2rem;
    border-radius: var(--radius);
    border: none;
    cursor: pointer;
    font-size: .9rem;
    font-weight: 600;
    transition: background .15s, transform .1s;
    text-decoration: none;
  }
  .btn:hover { transform: translateY(-1px); text-decoration: none; }
  .btn-primary  { background: var(--accent);  color: #fff; }
  .btn-primary:hover  { background: var(--accent-h); }
  .btn-danger   { background: var(--red);     color: #fff; }
  .btn-danger:hover   { background: #c03537; }
  .btn-success  { background: var(--green);   color: #fff; }
  .btn-success:hover  { background: #2d8a4e; }
  .btn-ghost    { background: var(--surface2); color: var(--text); border: 1px solid var(--border); }
  .btn-ghost:hover    { background: var(--border); }
  .btn-discord  {
    background: #5865f2;
    color: #fff;
    font-size: 1rem;
    padding: .75rem 2rem;
    border-radius: 12px;
  }
  .btn-discord:hover { background: #4752c4; }

  /* ── Hero (landing) ── */
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: calc(100vh - 60px);
    text-align: center;
    padding: 2rem;
    gap: 1.5rem;
  }
  .hero-icon { font-size: 5rem; }
  .hero h1 { font-size: 2.8rem; font-weight: 800; }
  .hero h1 span { color: var(--accent); }
  .hero p { font-size: 1.1rem; color: var(--muted); max-width: 480px; line-height: 1.6; }
  .hero-badges { display: flex; gap: .75rem; flex-wrap: wrap; justify-content: center; }
  .badge {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: .3rem .9rem;
    font-size: .8rem;
    color: var(--muted);
  }

  /* ── Layout ── */
  .container { max-width: 1100px; margin: 0 auto; padding: 2rem 1.5rem; }
  .page-title { font-size: 1.6rem; font-weight: 700; margin-bottom: 1.5rem; }
  .page-title span { color: var(--muted); font-size: 1rem; font-weight: 400; margin-left: .5rem; }

  /* ── Guild grid ── */
  .guild-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1rem;
  }
  .guild-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: .75rem;
    text-align: center;
    transition: border-color .15s, transform .15s;
  }
  .guild-card:hover { border-color: var(--accent); transform: translateY(-2px); }
  .guild-card img {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    border: 2px solid var(--border);
  }
  .guild-card .guild-name { font-weight: 600; font-size: .95rem; }
  .guild-card .guild-id   { font-size: .75rem; color: var(--muted); }

  /* ── Dashboard ── */
  .dash-layout {
    display: grid;
    grid-template-columns: 240px 1fr;
    gap: 1.5rem;
    align-items: start;
  }
  @media (max-width: 768px) {
    .dash-layout { grid-template-columns: 1fr; }
  }

  .sidebar {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    position: sticky;
    top: 76px;
  }
  .sidebar-title { font-size: .75rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: .75rem; padding: 0 .5rem; }
  .sidebar-item {
    display: flex;
    align-items: center;
    gap: .6rem;
    padding: .55rem .75rem;
    border-radius: 8px;
    color: var(--muted);
    font-size: .9rem;
    cursor: pointer;
    transition: background .12s, color .12s;
    border: none;
    background: none;
    width: 100%;
    text-align: left;
  }
  .sidebar-item:hover, .sidebar-item.active { background: var(--surface2); color: var(--text); }
  .sidebar-item.active { color: var(--accent); }

  /* ── Cards / Sections ── */
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    margin-bottom: 1rem;
  }
  .card-title {
    font-size: 1rem;
    font-weight: 700;
    margin-bottom: 1.25rem;
    display: flex;
    align-items: center;
    gap: .5rem;
  }
  .section { display: none; }
  .section.active { display: block; }

  /* ── Form ── */
  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }
  .form-group { display: flex; flex-direction: column; gap: .4rem; }
  .form-group label { font-size: .85rem; font-weight: 600; color: var(--muted); }
  .form-group input,
  .form-group select {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: .55rem .85rem;
    font-size: .9rem;
    outline: none;
    transition: border-color .15s;
    width: 100%;
  }
  .form-group input:focus,
  .form-group select:focus { border-color: var(--accent); }
  .form-group .hint { font-size: .75rem; color: var(--muted); }

  /* ── Toggle ── */
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: .75rem 0;
    border-bottom: 1px solid var(--border);
  }
  .toggle-row:last-child { border-bottom: none; }
  .toggle-info .toggle-label { font-weight: 600; font-size: .9rem; }
  .toggle-info .toggle-desc  { font-size: .8rem; color: var(--muted); margin-top: .15rem; }
  .toggle {
    position: relative;
    width: 44px;
    height: 24px;
    flex-shrink: 0;
  }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle-slider {
    position: absolute;
    inset: 0;
    background: var(--border);
    border-radius: 24px;
    cursor: pointer;
    transition: background .2s;
  }
  .toggle-slider::before {
    content: "";
    position: absolute;
    width: 18px;
    height: 18px;
    left: 3px;
    top: 3px;
    background: #fff;
    border-radius: 50%;
    transition: transform .2s;
  }
  .toggle input:checked + .toggle-slider { background: var(--accent); }
  .toggle input:checked + .toggle-slider::before { transform: translateX(20px); }

  /* ── Toast ── */
  #toast {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: .85rem 1.25rem;
    font-size: .9rem;
    display: flex;
    align-items: center;
    gap: .6rem;
    box-shadow: 0 8px 24px rgba(0,0,0,.4);
    transform: translateY(80px);
    opacity: 0;
    transition: transform .3s, opacity .3s;
    z-index: 999;
    max-width: 340px;
  }
  #toast.show { transform: translateY(0); opacity: 1; }
  #toast.success { border-color: var(--green); }
  #toast.error   { border-color: var(--red); }

  /* ── Status dot ── */
  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--green);
    display: inline-block;
    margin-right: .3rem;
  }

  /* ── Empty state ── */
  .empty {
    text-align: center;
    padding: 3rem 1rem;
    color: var(--muted);
  }
  .empty .empty-icon { font-size: 3rem; margin-bottom: 1rem; }
  .empty p { font-size: .95rem; }

  /* ── Responsive ── */
  @media (max-width: 600px) {
    .hero h1 { font-size: 2rem; }
    .navbar { padding: 0 1rem; }
    .container { padding: 1rem; }
  }
`;

const JS = `
  // ── Section navigation ──────────────────────────────────────────────
  function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(b => b.classList.remove('active'));
    const sec = document.getElementById('sec-' + id);
    const btn = document.getElementById('nav-' + id);
    if (sec) sec.classList.add('active');
    if (btn) btn.classList.add('active');
    localStorage.setItem('dynamo_section', id);
  }

  // ── Toast ────────────────────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
    t.className = 'show ' + type;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = ''; }, 3500);
  }

  // ── Load config ──────────────────────────────────────────────────────
  async function loadConfig(guildId) {
    try {
      const res = await fetch('/api/config?guild_id=' + guildId);
      if (!res.ok) return;
      const cfg = await res.json();

      const fields = [
        'welcome_channel_id','exit_channel_id','ticket_channel_id',
        'levels_channel_id','logs_channel_id','music_channel_id',
        'autorole_id','ticket_category_id','ticket_staff_roles'
      ];
      fields.forEach(f => {
        const el = document.getElementById(f);
        if (el && cfg[f]) el.value = cfg[f];
      });

      const iaToggle = document.getElementById('ia_enabled');
      if (iaToggle) iaToggle.checked = cfg.ia_enabled === 1 || cfg.ia_enabled === '1';
    } catch(e) {
      console.error('Error loading config:', e);
    }
  }

  // ── Save config ──────────────────────────────────────────────────────
  async function saveConfig(guildId) {
    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    const fields = [
      'welcome_channel_id','exit_channel_id','ticket_channel_id',
      'levels_channel_id','logs_channel_id','music_channel_id',
      'autorole_id','ticket_category_id','ticket_staff_roles'
    ];

    const data = { guild_id: guildId };
    fields.forEach(f => {
      const el = document.getElementById(f);
      if (el) data[f] = el.value.trim() || null;
    });

    const iaToggle = document.getElementById('ia_enabled');
    if (iaToggle) data.ia_enabled = iaToggle.checked ? 1 : 0;

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        showToast('Configuración guardada correctamente');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error ?? 'Error al guardar', 'error');
      }
    } catch(e) {
      showToast('Error de red al guardar', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '💾 Guardar cambios';
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('dynamo_section') || 'channels';
    showSection(saved);

    const guildId = document.getElementById('guild-id-data')?.dataset?.guildId;
    if (guildId) loadConfig(guildId);
  });
`;

// ─── Page templates ───────────────────────────────────────────────────────────
function htmlShell(title: string, body: string, includeJs = false): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — DynamoBot</title>
  <style>${CSS}</style>
</head>
<body>
${body}
${includeJs ? `<script>${JS}</script>` : ""}
</body>
</html>`;
}

function navbarHtml(user?: DiscordUser): string {
  const userHtml = user
    ? `<div class="navbar-user">
        <img src="${avatarUrl(user)}" alt="avatar" />
        <span class="username">${user.global_name ?? user.username}</span>
        <a href="/auth/logout" class="btn btn-ghost" style="padding:.35rem .8rem;font-size:.8rem;">Salir</a>
      </div>`
    : `<a href="/auth/login" class="btn btn-primary">Iniciar sesión</a>`;

  return `<nav class="navbar">
  <a href="/" class="navbar-brand"><span class="logo">⚡</span> DynamoBot</a>
  ${userHtml}
</nav>`;
}

function landingPage(): string {
  return htmlShell("Inicio", `
${navbarHtml()}
<main class="hero">
  <div class="hero-icon">⚡</div>
  <h1>Panel de <span>DynamoBot</span></h1>
  <p>Gestiona la configuración de tu servidor de Discord de forma visual, sin necesidad de usar comandos.</p>
  <div class="hero-badges">
    <span class="badge">🎵 Música</span>
    <span class="badge">🎫 Tickets</span>
    <span class="badge">👋 Bienvenidas</span>
    <span class="badge">📊 Niveles</span>
    <span class="badge">🤖 IA</span>
    <span class="badge">📋 Logs</span>
  </div>
  <a href="/auth/login" class="btn btn-discord">
    <svg width="20" height="20" viewBox="0 0 71 55" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M60.1 4.9A58.5 58.5 0 0 0 45.5.4a.2.2 0 0 0-.2.1 40.7 40.7 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.7 37.7 0 0 0 25.5.5a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.7 4.9a.2.2 0 0 0-.1.1C1.6 18.1-.9 31 .3 43.7a.2.2 0 0 0 .1.2 58.8 58.8 0 0 0 17.7 9 .2.2 0 0 0 .2-.1 42 42 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.7 38.7 0 0 1-5.5-2.6.2.2 0 0 1 0-.4l1.1-.8a.2.2 0 0 1 .2 0c11.5 5.3 24 5.3 35.4 0a.2.2 0 0 1 .2 0l1.1.8a.2.2 0 0 1 0 .4 36.2 36.2 0 0 1-5.5 2.6.2.2 0 0 0-.1.3 47.1 47.1 0 0 0 3.6 5.9.2.2 0 0 0 .2.1 58.6 58.6 0 0 0 17.8-9 .2.2 0 0 0 .1-.2C73.1 29.2 69.2 16.4 60.2 5a.2.2 0 0 0-.1-.1ZM23.7 36.2c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2Zm23.7 0c-3.5 0-6.4-3.2-6.4-7.2s2.8-7.2 6.4-7.2c3.6 0 6.5 3.3 6.4 7.2 0 4-2.8 7.2-6.4 7.2Z" fill="currentColor"/>
    </svg>
    Entrar con Discord
  </a>
</main>`);
}

function guildSelectPage(user: DiscordUser, guilds: DiscordGuild[]): string {
  const adminGuilds = guilds.filter(g => isAdmin(g.permissions));

  const cards = adminGuilds.length === 0
    ? `<div class="empty"><div class="empty-icon">🏰</div><p>No tienes permisos de administrador en ningún servidor.</p></div>`
    : adminGuilds.map(g => {
        const icon = g.icon
          ? `<img src="https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128" alt="${g.name}" />`
          : `<div style="width:64px;height:64px;border-radius:50%;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:1.5rem;border:2px solid var(--border);">🏰</div>`;
        return `<a href="/dashboard?guild_id=${g.id}" class="guild-card" style="text-decoration:none;color:inherit;">
          ${icon}
          <div class="guild-name">${g.name}</div>
          <div class="guild-id">${g.id}</div>
          <span class="btn btn-primary" style="font-size:.8rem;padding:.35rem .9rem;margin-top:.25rem;">Configurar</span>
        </a>`;
      }).join("\n");

  return htmlShell("Seleccionar servidor", `
${navbarHtml(user)}
<div class="container">
  <div class="page-title">Mis servidores <span>Selecciona un servidor para configurar</span></div>
  <div class="guild-grid">${cards}</div>
</div>`);
}

function dashboardPage(user: DiscordUser, guild: DiscordGuild): string {
  const guildIcon = guild.icon
    ? `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64" alt="${guild.name}" style="width:40px;height:40px;border-radius:50%;border:2px solid var(--border);" />`
    : `<span style="font-size:1.5rem;">🏰</span>`;

  const sidebar = `
<aside class="sidebar">
  <div class="sidebar-title">Configuración</div>
  <button class="sidebar-item" id="nav-channels" onclick="showSection('channels')">📢 Canales</button>
  <button class="sidebar-item" id="nav-roles"    onclick="showSection('roles')">🎭 Roles</button>
  <button class="sidebar-item" id="nav-features" onclick="showSection('features')">⚙️ Funciones</button>
  <button class="sidebar-item" id="nav-tickets"  onclick="showSection('tickets')">🎫 Tickets</button>
  <div style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border);">
    <a href="/guilds" class="sidebar-item" style="color:var(--muted);">← Volver</a>
  </div>
</aside>`;

  const channelsSection = `
<div class="section" id="sec-channels">
  <div class="card">
    <div class="card-title">📢 Canales del servidor</div>
    <div class="form-grid">
      <div class="form-group">
        <label for="welcome_channel_id">Canal de bienvenidas</label>
        <input id="welcome_channel_id" type="text" placeholder="ID del canal (ej: 123456789)" />
        <span class="hint">Donde se envían los mensajes de bienvenida</span>
      </div>
      <div class="form-group">
        <label for="exit_channel_id">Canal de salida</label>
        <input id="exit_channel_id" type="text" placeholder="ID del canal" />
        <span class="hint">Donde se notifica cuando alguien sale</span>
      </div>
      <div class="form-group">
        <label for="levels_channel_id">Canal de niveles</label>
        <input id="levels_channel_id" type="text" placeholder="ID del canal" />
        <span class="hint">Donde se anuncian los cambios de nivel</span>
      </div>
      <div class="form-group">
        <label for="logs_channel_id">Canal de logs</label>
        <input id="logs_channel_id" type="text" placeholder="ID del canal" />
        <span class="hint">Registro de eventos del servidor</span>
      </div>
      <div class="form-group">
        <label for="music_channel_id">Canal de música</label>
        <input id="music_channel_id" type="text" placeholder="ID del canal" />
        <span class="hint">Canal asociado al reproductor de música</span>
      </div>
    </div>
  </div>
</div>`;

  const rolesSection = `
<div class="section" id="sec-roles">
  <div class="card">
    <div class="card-title">🎭 Roles automáticos</div>
    <div class="form-grid">
      <div class="form-group">
        <label for="autorole_id">Rol automático</label>
        <input id="autorole_id" type="text" placeholder="ID del rol" />
        <span class="hint">Rol asignado automáticamente al entrar al servidor</span>
      </div>
    </div>
  </div>
</div>`;

  const featuresSection = `
<div class="section" id="sec-features">
  <div class="card">
    <div class="card-title">⚙️ Funciones del bot</div>
    <div class="toggle-row">
      <div class="toggle-info">
        <div class="toggle-label">🤖 Asistente de IA</div>
        <div class="toggle-desc">Permite que el bot responda mensajes con inteligencia artificial</div>
      </div>
      <label class="toggle">
        <input type="checkbox" id="ia_enabled" />
        <span class="toggle-slider"></span>
      </label>
    </div>
  </div>
</div>`;

  const ticketsSection = `
<div class="section" id="sec-tickets">
  <div class="card">
    <div class="card-title">🎫 Sistema de tickets</div>
    <div class="form-grid">
      <div class="form-group">
        <label for="ticket_channel_id">Canal de tickets</label>
        <input id="ticket_channel_id" type="text" placeholder="ID del canal" />
        <span class="hint">Canal donde los usuarios abren tickets</span>
      </div>
      <div class="form-group">
        <label for="ticket_category_id">Categoría de tickets</label>
        <input id="ticket_category_id" type="text" placeholder="ID de la categoría" />
        <span class="hint">Categoría donde se crean los canales de ticket</span>
      </div>
      <div class="form-group">
        <label for="ticket_staff_roles">Rol de staff</label>
        <input id="ticket_staff_roles" type="text" placeholder="ID del rol" />
        <span class="hint">Rol que puede gestionar y ver los tickets</span>
      </div>
    </div>
  </div>
</div>`;

  const mainContent = `
<div>
  <div class="card" style="margin-bottom:1rem;padding:1rem 1.5rem;">
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem;">
      <div style="display:flex;align-items:center;gap:.75rem;">
        ${guildIcon}
        <div>
          <div style="font-weight:700;font-size:1.05rem;">${guild.name}</div>
          <div style="font-size:.8rem;color:var(--muted);">ID: ${guild.id}</div>
        </div>
      </div>
      <button id="save-btn" class="btn btn-success" onclick="saveConfig('${guild.id}')">💾 Guardar cambios</button>
    </div>
  </div>
  ${channelsSection}
  ${rolesSection}
  ${featuresSection}
  ${ticketsSection}
</div>`;

  return htmlShell(`${guild.name} — Dashboard`, `
<span id="guild-id-data" data-guild-id="${guild.id}" style="display:none;"></span>
${navbarHtml(user)}
<div class="container">
  <div class="dash-layout">
    ${sidebar}
    ${mainContent}
  </div>
</div>
<div id="toast"></div>`, true);
}

function errorPage(message: string, backUrl = "/"): string {
  return htmlShell("Error", `
${navbarHtml()}
<div class="hero">
  <div class="hero-icon">⚠️</div>
  <h1 style="font-size:2rem;">Algo salió mal</h1>
  <p>${message}</p>
  <a href="${backUrl}" class="btn btn-primary">Volver</a>
</div>`);
}

// ─── App ──────────────────────────────────────────────────────────────────────
const app = new Elysia()
  .use(cors())
  .use(cookie())
  .use(
    jwt({
      name:   "jwtAuth",
      secret: JWT_SECRET,
    })
  )

  // ── Landing ──────────────────────────────────────────────────────────
  .get("/", () =>
    new Response(landingPage(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    })
  )

  // ── Auth: Login ──────────────────────────────────────────────────────
  .get("/auth/login", () =>
    new Response(null, {
      status:  302,
      headers: { Location: DISCORD_OAUTH_URL },
    })
  )

  // ── Auth: Callback ───────────────────────────────────────────────────
  .get(
    "/auth/callback",
    async ({ query, jwtAuth, cookie: { token } }) => {
      const code = query.code as string | undefined;
      if (!code) {
        return new Response(errorPage("No se recibió el código de autorización de Discord."), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      try {
        const tokenData = await exchangeCode(code);
        const user      = await fetchDiscordUser(tokenData.access_token);
        const guilds    = await fetchDiscordGuilds(tokenData.access_token);

        const payload = {
          userId:      user.id,
          username:    user.username,
          globalName:  user.global_name ?? user.username,
          avatar:      user.avatar ?? "",
          accessToken: tokenData.access_token,
          guilds:      guilds,
        };

        const signed = await jwtAuth.sign(payload);

        token.set({
          value:    signed,
          httpOnly: true,
          secure:   process.env.NODE_ENV === "production",
          sameSite: "lax",
          maxAge:   60 * 60 * 24, // 24 h
          path:     "/",
        });

        return new Response(null, {
          status:  302,
          headers: { Location: "/guilds" },
        });
      } catch (err) {
        console.error("[OAuth] Error en callback:", err);
        return new Response(
          errorPage("Error al autenticar con Discord. Intenta de nuevo."),
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
    }
  )

  // ── Auth: Logout ─────────────────────────────────────────────────────
  .get("/auth/logout", ({ cookie: { token } }) => {
    token.remove();
    return new Response(null, {
      status:  302,
      headers: { Location: "/" },
    });
  })

  // ── Guild selector ───────────────────────────────────────────────────
  .get("/guilds", async ({ jwtAuth, cookie: { token } }) => {
    const raw = token.value;
    if (!raw) {
      return new Response(null, { status: 302, headers: { Location: "/auth/login" } });
    }

    const payload = await jwtAuth.verify(raw) as Record<string, unknown> | false;
    if (!payload) {
      return new Response(null, { status: 302, headers: { Location: "/auth/login" } });
    }

    const user: DiscordUser = {
      id:          payload.userId as string,
      username:    payload.username as string,
      global_name: payload.globalName as string,
      avatar:      payload.avatar as string,
      discriminator: "0",
    };
    const guilds = payload.guilds as DiscordGuild[];

    return new Response(guildSelectPage(user, guilds), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  })

  // ── Dashboard ────────────────────────────────────────────────────────
  .get("/dashboard", async ({ query, jwtAuth, cookie: { token } }) => {
    const raw = token.value;
    if (!raw) {
      return new Response(null, { status: 302, headers: { Location: "/auth/login" } });
    }

    const payload = await jwtAuth.verify(raw) as Record<string, unknown> | false;
    if (!payload) {
      return new Response(null, { status: 302, headers: { Location: "/auth/login" } });
    }

    const guildId = query.guild_id as string | undefined;
    if (!guildId) {
      return new Response(null, { status: 302, headers: { Location: "/guilds" } });
    }

    const guilds = payload.guilds as DiscordGuild[];
    const guild  = guilds.find(g => g.id === guildId);

    if (!guild || !isAdmin(guild.permissions)) {
      return new Response(
        errorPage("No tienes permisos de administrador en ese servidor.", "/guilds"),
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    const user: DiscordUser = {
      id:            payload.userId as string,
      username:      payload.username as string,
      global_name:   payload.globalName as string,
      avatar:        payload.avatar as string,
      discriminator: "0",
    };

    return new Response(dashboardPage(user, guild), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  })

  // ── API: GET config ──────────────────────────────────────────────────
  .get("/api/config", async ({ query, jwtAuth, cookie: { token } }) => {
    const raw = token.value;
    if (!raw) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const payload = await jwtAuth.verify(raw) as Record<string, unknown> | false;
    if (!payload) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const guildId = query.guild_id as string | undefined;
    if (!guildId) {
      return new Response(JSON.stringify({ error: "guild_id requerido" }), { status: 400 });
    }

    const guilds = payload.guilds as DiscordGuild[];
    const guild  = guilds.find(g => g.id === guildId);
    if (!guild || !isAdmin(guild.permissions)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }

    try {
      const cfg = await getGuildConfig(guildId);
      return new Response(JSON.stringify(cfg ?? {}), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[API] GET /api/config error:", err);
      return new Response(JSON.stringify({ error: "Error interno" }), { status: 500 });
    }
  })

  // ── API: POST config ─────────────────────────────────────────────────
  .post("/api/config", async ({ body, jwtAuth, cookie: { token } }) => {
    const raw = token.value;
    if (!raw) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const payload = await jwtAuth.verify(raw) as Record<string, unknown> | false;
    if (!payload) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

    const data = body as Record<string, string | number | null>;
    const guildId = data.guild_id as string | undefined;

    if (!guildId) {
      return new Response(JSON.stringify({ error: "guild_id requerido" }), { status: 400 });
    }

    const guilds = payload.guilds as DiscordGuild[];
    const guild  = guilds.find(g => g.id === guildId);
    if (!guild || !isAdmin(guild.permissions)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }

    try {
      await upsertGuildConfig(guildId, data);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[API] POST /api/config error:", err);
      return new Response(JSON.stringify({ error: "Error al guardar" }), { status: 500 });
    }
  })

  // ── Health check ─────────────────────────────────────────────────────
  .get("/health", () =>
    new Response(JSON.stringify({ status: "ok", service: "dynamo-panel" }), {
      headers: { "Content-Type": "application/json" },
    })
  );

// ─── Start ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    if (DATABASE_URL) {
      await ensureTables();
    } else {
      console.warn("[WARN] DATABASE_URL no configurada — la persistencia estará deshabilitada.");
    }

    app.listen(PORT, () => {
      console.log(`[OK] DynamoBot Panel corriendo en http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error("[FATAL] Error al iniciar el panel:", err);
    process.exit(1);
  }
})();
