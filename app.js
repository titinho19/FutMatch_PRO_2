'use strict';

/* ============================================================
   JOGO BONITO WALKING F.C. — Lógica v2
   Hoja de jugadores (SheetDB): id, nombre, posicion, pac, sho,
   pas, dri, def, phy, foto, goles, mvp, partidos
   Hoja de actas (misma API, ?sheet=Partidos): id, jornada,
   fecha, data (JSON)
   ============================================================ */

const DEFAULT_PLAYERS_API = 'https://sheetdb.io/api/v1/bhahe403p8ubp';
const DEFAULT_MATCHES_SHEET = 'Partidos';
const LS = {
  playersApi: 'jb_api_players_v2',
  matchesApi: 'jb_api_matches_v2',
  matchesSheet: 'jb_matches_sheet_v2',
  playersCache: 'jb_players_cache_v2',
  matches: 'jb_matches_v2',
  draft: 'jb_draft_v2',
  selected: 'jb_selected_v2',
  tab: 'jb_tab_v2',
  syncAt: 'jb_sync_at_v2',
  deleted: 'jb_deleted_matches_v2'
};
const POS_PRESETS = {
  POR: { pac: 48, sho: 32, pas: 58, dri: 45, def: 82, phy: 80 },
  DEF: { pac: 62, sho: 45, pas: 65, dri: 58, def: 84, phy: 78 },
  MED: { pac: 70, sho: 68, pas: 80, dri: 74, def: 62, phy: 70 },
  DEL: { pac: 80, sho: 84, pas: 66, dri: 79, def: 40, phy: 72 }
};
const VALID_POS = ['POR', 'DEF', 'MED', 'DEL'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* sin espacio */ } }
function lsDel(key) { try { localStorage.removeItem(key); } catch (e) { /* nada */ } }

/* SheetDB permite leer otra pestaña del mismo documento con ?sheet= */
function apiWithSheet(url, sheet) {
  if (!url || !sheet) return '';
  try {
    const u = new URL(url);
    u.searchParams.delete('sheet');
    const qs = u.searchParams.toString();
    const base = u.origin + u.pathname.replace(/\/$/, '') + (qs ? '?' + qs : '');
    return base + (qs ? '&' : '?') + 'sheet=' + encodeURIComponent(sheet);
  } catch (e) {
    const sep = url.includes('?') ? '&' : '?';
    return url.replace(/\/$/, '') + sep + 'sheet=' + encodeURIComponent(sheet);
  }
}
/* Añade /id/<id> antes de la query, para no romper ?sheet= */
function apiIdUrl(url, id) {
  const suffix = '/id/' + encodeURIComponent(id);
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/$/, '') + suffix + u.search;
  } catch (e) {
    return url.replace(/\/$/, '') + suffix;
  }
}

const store = {
  get playersApi() { return lsGet(LS.playersApi) || DEFAULT_PLAYERS_API; },
  set playersApi(v) { v ? lsSet(LS.playersApi, v) : lsDel(LS.playersApi); },
  get matchesSheet() {
    const raw = lsGet(LS.matchesSheet);
    return raw === null ? DEFAULT_MATCHES_SHEET : raw.trim();
  },
  set matchesSheet(v) { lsSet(LS.matchesSheet, v || ''); },
  get matchesApi() {
    const override = lsGet(LS.matchesApi);
    if (override) return override;
    return apiWithSheet(store.playersApi, store.matchesSheet);
  },
  set matchesApi(v) { v ? lsSet(LS.matchesApi, v) : lsDel(LS.matchesApi); }
};

const state = {
  players: [],
  matches: [],
  selected: new Set(),
  draft: blankDraft(),
  search: '',
  posFilter: 'ALL',
  rankQuery: '',
  rankSort: { key: 'goles', dir: -1 },
  editingPlayerId: null,
  photo: '',
  editingMatchId: null,
  editingMatch: null,
  remoteMatchIds: new Set(),
  matchesRemoteOk: null,
  booted: false,
  online: true,
  saving: false,
  remoteWarned: false
};

/* ================= FECHAS / IDS / AVATARES ================= */
function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function fmtDate(iso) {
  if (!iso) return 'Sin fecha';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d.getTime())) return iso;
  const s = d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function uid(prefix) {
  return (prefix || 'm') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
  const a = (parts[0] || '?').charAt(0);
  const b = parts[1] ? parts[1].charAt(0) : '';
  return (a + b).toUpperCase();
}
function avatarFallback(name) {
  const palettes = [
    ['#22c55e', '#0f766e'], ['#f5c451', '#b45309'], ['#60a5fa', '#1e40af'],
    ['#c084fc', '#6d28d9'], ['#f472b6', '#9d174d'], ['#34d399', '#065f46']
  ];
  const seed = Array.from(String(name || '')).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const pair = palettes[seed % palettes.length];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="' + pair[0] + '"/><stop offset="1" stop-color="' + pair[1] + '"/>' +
    '</linearGradient></defs><rect width="120" height="120" fill="url(#g)"/>' +
    '<text x="60" y="63" font-family="Arial,Helvetica,sans-serif" font-size="46" font-weight="bold" ' +
    'fill="#07110c" text-anchor="middle" dominant-baseline="middle">' + initials(name) + '</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg).replace(/'/g, '%27');
}
function avatarOf(p) {
  return (p && p.foto && String(p.foto).trim()) ? String(p.foto).trim() : avatarFallback(p ? p.nombre : '');
}
function avatarImg(p, cls, alt) {
  return '<img class="' + cls + '" src="' + esc(avatarOf(p)) + '" alt="' + esc(alt || p.nombre || '') +
    '" loading="lazy" onerror="this.onerror=null;this.src=\'' + avatarFallback(p ? p.nombre : '') + '\'">';
}
function overall(p) {
  const keys = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
  const sum = keys.reduce((acc, k) => acc + (Number(p[k]) || 60), 0);
  return Math.round(sum / keys.length);
}
function tierClass(ovr) {
  if (ovr >= 82) return 'tier-gold';
  if (ovr >= 74) return 'tier-silver';
  return 'tier-bronze';
}
function safePos(pos) {
  const p = String(pos || 'MED').toUpperCase();
  return VALID_POS.includes(p) ? p : 'MED';
}
function playerById(id) {
  return state.players.find((p) => String(p.id) === String(id));
}

/* ================= MARCADOR / ESTADÍSTICAS DE ACTAS ================= */
function matchScore(m) {
  const goals = m.goals || {};
  const sum = (team) => (team || []).reduce((acc, p) => acc + (Number(goals[p.id]) || 0), 0);
  return [sum(m.teamA), sum(m.teamB)];
}
function statsMap(m) {
  const map = new Map();
  [m.teamA || [], m.teamB || []].forEach((team) => {
    team.forEach((p) => {
      const id = String(p.id);
      if (!map.has(id)) map.set(id, { goles: 0, mvp: 0, partidos: 0 });
      map.get(id).partidos += 1;
    });
  });
  Object.keys(m.goals || {}).forEach((rawId) => {
    const id = String(rawId);
    if (!map.has(id)) return;
    map.get(id).goles += Number(m.goals[rawId]) || 0;
  });
  if (m.mvpId) {
    const id = String(m.mvpId);
    if (map.has(id)) map.get(id).mvp += 1;
  }
  return map;
}
function diffStats(oldMap, newMap) {
  const ids = new Set([...oldMap.keys(), ...newMap.keys()]);
  const out = new Map();
  ids.forEach((id) => {
    const o = oldMap.get(id) || { goles: 0, mvp: 0, partidos: 0 };
    const n = newMap.get(id) || { goles: 0, mvp: 0, partidos: 0 };
    const d = { goles: n.goles - o.goles, mvp: n.mvp - o.mvp, partidos: n.partidos - o.partidos };
    if (d.goles || d.mvp || d.partidos) out.set(id, d);
  });
  return out;
}
function matchesSorted(desc) {
  const arr = [...state.matches].sort((a, b) => {
    const fa = a.fecha || '';
    const fb = b.fecha || '';
    if (fa !== fb) return fa.localeCompare(fb);
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
  });
  return desc ? arr.reverse() : arr;
}
function nextJornada() {
  const max = state.matches.reduce((acc, m) => Math.max(acc, Number(m.jornada) || 0), 0);
  return max + 1;
}
function recentMatchesFor(playerId, limit) {
  const id = String(playerId);
  return matchesSorted(false).filter((m) =>
    [...(m.teamA || []), ...(m.teamB || [])].some((p) => String(p.id) === id)
  ).slice(-(limit || 5)).reverse();
}
function formaHTML(playerId) {
  const recent = recentMatchesFor(playerId, 5).reverse();
  if (!recent.length) return '<span class="muted">–</span>';
  const dots = recent.map((m) => {
    const inA = (m.teamA || []).some((p) => String(p.id) === String(playerId));
    const [ga, gb] = matchScore(m);
    const own = inA ? ga : gb;
    const rival = inA ? gb : ga;
    const out = own > rival ? 'V' : own < rival ? 'D' : 'E';
    const goals = Number((m.goals || {})[playerId]) || 0;
    const title = 'J' + (m.jornada || '?') + ' · ' + fmtDate(m.fecha) + ' · ' +
      (out === 'V' ? 'Victoria' : out === 'D' ? 'Derrota' : 'Empate') +
      (goals ? ' · ' + goals + ' gol(es)' : '') + (String(m.mvpId) === String(playerId) ? ' · MVP' : '');
    return '<span class="form-dot ' + out + '" title="' + esc(title) + '">' + out + '</span>';
  }).join('');
  return '<div class="form-dots">' + dots + '</div>';
}

/* ================= ALMACENAMIENTO ================= */
function blankDraft() {
  return { A: [], B: [], goals: {}, mvpId: null, fecha: todayISO(), jornada: '', notas: '' };
}
function readPlayerCache() {
  try {
    const raw = lsGet(LS.playersCache);
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) ? arr : null;
  } catch (e) { return null; }
}
function writePlayerCache() {
  lsSet(LS.playersCache, JSON.stringify(state.players));
}
function readMatches() {
  try {
    const raw = lsGet(LS.matches);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function persistMatches() {
  lsSet(LS.matches, JSON.stringify(state.matches));
}
function readSelection() {
  try {
    const raw = lsGet(LS.selected);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (e) { return []; }
}
function persistSelection() {
  lsSet(LS.selected, JSON.stringify([...state.selected]));
}
function readDeletedIds() {
  try {
    const raw = lsGet(LS.deleted);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch (e) { return []; }
}
function markDeletedId(id) {
  const arr = readDeletedIds();
  if (!arr.includes(String(id))) arr.push(String(id));
  lsSet(LS.deleted, JSON.stringify(arr));
}
function readDraft() {
  try {
    const raw = lsGet(LS.draft);
    const d = raw ? JSON.parse(raw) : null;
    if (!d || typeof d !== 'object') return null;
    return {
      A: Array.isArray(d.A) ? d.A.map(String) : [],
      B: Array.isArray(d.B) ? d.B.map(String) : [],
      goals: d.goals && typeof d.goals === 'object' ? d.goals : {},
      mvpId: d.mvpId ? String(d.mvpId) : null,
      fecha: d.fecha || todayISO(),
      jornada: d.jornada == null ? '' : String(d.jornada),
      notas: d.notas || ''
    };
  } catch (e) { return null; }
}
function draftTeams() {
  return {
    A: state.draft.A.map(playerById).filter(Boolean),
    B: state.draft.B.map(playerById).filter(Boolean)
  };
}
function saveDraft() {
  const teams = draftTeams();
  if (!teams.A.length && !teams.B.length) { lsDel(LS.draft); return; }
  lsSet(LS.draft, JSON.stringify(state.draft));
}

/* ================= UI BÁSICA ================= */
function toast(msg, type, ms) {
  const wrap = $('#toasts');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (type || 'info');
  const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';
  el.innerHTML = '<span class="toast-icon">' + icon + '</span><span>' + esc(msg) + '</span>';
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms || 3800);
}
function setSyncState(stateName, text) {
  const pill = $('#syncPill');
  if (!pill) return;
  pill.dataset.state = stateName;
  const labels = { ok: 'Sincronizado', syncing: 'Sincronizando…', error: 'Sin conexión', local: 'Guardado local' };
  const node = $('#syncText');
  if (node) node.textContent = text || labels[stateName] || '';
}
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('open');
  document.body.classList.add('modal-open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('open');
  if (!document.querySelector('.modal-overlay.open')) document.body.classList.remove('modal-open');
}
let confirmResolver = null;
function askConfirm(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    confirmResolver = resolve;
    $('#confirmTitle').textContent = o.title || '¿Confirmar acción?';
    $('#confirmMessage').textContent = o.message || '';
    const ok = $('#confirmOk');
    ok.textContent = o.confirmText || 'Confirmar';
    ok.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
    openModal('confirmModal');
  });
}
function resolveConfirm(value) {
  const fn = confirmResolver;
  confirmResolver = null;
  closeModal('confirmModal');
  if (fn) fn(value);
}
async function copyText(text, okMsg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMsg || 'Copiado al portapapeles', 'success');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(okMsg || 'Copiado al portapapeles', 'success'); }
    catch (err) { toast('No se pudo copiar el texto', 'error'); }
    ta.remove();
  }
}

/* ================= API SHEETDB ================= */
function normalizePlayers(data) {
  if (!Array.isArray(data)) return [];
  return data
    .filter((p) => p && p.id && (p.nombre || p.name) && String(p.nombre || p.name).trim() !== '')
    .map((p) => ({
      id: String(p.id),
      nombre: String(p.nombre || p.name).trim(),
      posicion: safePos(p.posicion || p.position),
      pac: Number(p.pac) || 60,
      sho: Number(p.sho) || 65,
      pas: Number(p.pas) || 70,
      dri: Number(p.dri) || 65,
      def: Number(p.def) || 65,
      phy: Number(p.phy) || 70,
      foto: p.foto || '',
      goles: Number(p.goles) || 0,
      mvp: Number(p.mvp) || 0,
      partidos: Number(p.partidos) || 0
    }));
}
function buildPlayerPayload(p) {
  return {
    id: String(p.id),
    nombre: String(p.nombre),
    posicion: safePos(p.posicion),
    pac: Number(p.pac) || 60,
    sho: Number(p.sho) || 65,
    pas: Number(p.pas) || 70,
    dri: Number(p.dri) || 65,
    def: Number(p.def) || 65,
    phy: Number(p.phy) || 70,
    foto: p.foto || '',
    goles: Number(p.goles) || 0,
    mvp: Number(p.mvp) || 0,
    partidos: Number(p.partidos) || 0
  };
}
async function patchPlayer(p) {
  const res = await fetch(apiIdUrl(store.playersApi, p.id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: buildPlayerPayload(p) })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res;
}
async function postPlayer(p) {
  const res = await fetch(store.playersApi, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: [buildPlayerPayload(p)] })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res;
}
async function deletePlayerRemote(p) {
  const res = await fetch(apiIdUrl(store.playersApi, p.id), { method: 'DELETE' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res;
}

/* ================= CARGA Y SINCRONIZACIÓN ================= */
function showSkeleton() {
  const box = $('#loadingState');
  if (!box) return;
  box.innerHTML = Array.from({ length: 8 }, () => '<div class="skel"></div>').join('');
  box.hidden = false;
}
function hideSkeleton() {
  const box = $('#loadingState');
  if (!box) return;
  box.innerHTML = '';
  box.hidden = true;
}
function finalizeBootstrap() {
  const selected = readSelection().filter((id) => playerById(id));
  state.selected = new Set(selected);
  const savedDraft = readDraft();
  if (savedDraft) state.draft = savedDraft;
  pruneDraft();
  renderAll();
  if (!state.booted) {
    state.booted = true;
    retryAllUnsynced();
    syncMatchesRemote(true);
  }
}
async function fetchPlayers(force) {
  const cached = force ? null : readPlayerCache();
  if (cached && cached.length) {
    state.players = cached;
    hideSkeleton();
    finalizeBootstrap();
    setSyncState('local');
    const last = Number(lsGet(LS.syncAt)) || 0;
    if (Date.now() - last > 10 * 60 * 1000) backgroundSync();
    return;
  }
  showSkeleton();
  const errorBox = $('#loadError');
  if (errorBox) errorBox.hidden = true;
  setSyncState('syncing');
  try {
    const res = await fetch(store.playersApi, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.players = normalizePlayers(data);
    lsSet(LS.syncAt, String(Date.now()));
    writePlayerCache();
    hideSkeleton();
    finalizeBootstrap();
    setSyncState('ok');
  } catch (err) {
    console.error('Error cargando plantilla:', err);
    hideSkeleton();
    if (!state.players.length) {
      if (errorBox) errorBox.hidden = false;
      setSyncState('error');
    } else {
      setSyncState('error', 'Sin conexión (caché)');
    }
  }
}
async function backgroundSync() {
  if (state.saving) return;
  setSyncState('syncing');
  try {
    const res = await fetch(store.playersApi, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.players = normalizePlayers(data);
    lsSet(LS.syncAt, String(Date.now()));
    writePlayerCache();
    pruneDraft();
    renderAll();
    setSyncState('ok');
  } catch (err) {
    setSyncState('error', 'Sin conexión (caché)');
  }
}

/* ================= PLANTILLA ================= */
function renderAll() {
  renderPlayers();
  renderDash();
  renderMatch();
  renderHistory();
  renderRanking();
}
function renderPlayers() {
  const grid = $('#playersGrid');
  if (!grid) return;
  const q = state.search.trim().toLowerCase();
  const list = state.players
    .filter((p) => (!q || p.nombre.toLowerCase().includes(q)) &&
      (state.posFilter === 'ALL' || safePos(p.posicion) === state.posFilter))
    .sort((a, b) => overall(b) - overall(a) || a.nombre.localeCompare(b.nombre));

  let topScorerId = null;
  let maxGoals = 0;
  state.players.forEach((p) => {
    if (Number(p.goles) > maxGoals) { maxGoals = Number(p.goles); topScorerId = p.id; }
  });

  grid.innerHTML = list.map((p) => {
    const ovr = overall(p);
    const pos = safePos(p.posicion);
    const selected = state.selected.has(p.id);
    const crown = topScorerId === p.id && maxGoals > 0 ? '<span class="crown" title="Máximo goleador">👑</span>' : '';
    return '<article class="player-card ' + tierClass(ovr) + (selected ? ' selected' : '') + '" data-id="' + esc(p.id) + '">' +
      '<div class="check-badge">✓</div>' +
      '<div class="card-top">' +
        '<div class="ovr-badge"><b>' + ovr + '</b><small>OVR</small></div>' +
        '<span class="pos-tag pos-' + pos + '">' + pos + '</span>' +
      '</div>' +
      '<div class="avatar">' + avatarImg(p, '', 'Foto de ' + p.nombre) + crown + '</div>' +
      '<h3 class="player-name" title="' + esc(p.nombre) + '">' + esc(p.nombre) + '</h3>' +
      '<div class="fifa-stats">' +
        '<span>PAC <b>' + p.pac + '</b></span><span>SHO <b>' + p.sho + '</b></span><span>PAS <b>' + p.pas + '</b></span>' +
        '<span>DRI <b>' + p.dri + '</b></span><span>DEF <b>' + p.def + '</b></span><span>PHY <b>' + p.phy + '</b></span>' +
      '</div>' +
      '<div class="mini-stats">' +
        '<div><b>' + p.goles + '</b>Goles</div>' +
        '<div><b>' + p.mvp + '</b>MVP</div>' +
        '<div><b>' + p.partidos + '</b>PJ</div>' +
      '</div>' +
      '<div class="card-actions">' +
        '<button class="act-edit" type="button" data-action="edit">✏️ Editar</button>' +
        '<button class="act-del" type="button" data-action="delete" aria-label="Eliminar">🗑️</button>' +
      '</div>' +
    '</article>';
  }).join('');
  $('#playersEmpty').hidden = list.length > 0 || !$('#loadError').hidden;
}
function renderDash() {
  const setText = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };
  setText('#dashPlayers', state.players.length);
  setText('#dashSelected', state.selected.size);
  setText('#dashMatches', state.matches.length);
  setText('#selectedCount', state.selected.size);
  const pool = state.selected.size
    ? state.players.filter((p) => state.selected.has(p.id))
    : state.players;
  setText('#dashAvg', pool.length ? (pool.reduce((a, p) => a + overall(p), 0) / pool.length).toFixed(1) : '–');
  const all = state.players.length > 0 && state.selected.size === state.players.length;
  const btn = $('#btnSelectAll');
  if (btn) btn.textContent = all ? 'Quitar todos' : 'Seleccionar todos';
  const badge = $('.selected-pill');
  if (badge) badge.style.opacity = state.selected.size ? '1' : '.6';
}
function togglePlayerSelection(id) {
  const key = String(id);
  if (state.selected.has(key)) state.selected.delete(key);
  else state.selected.add(key);
  persistSelection();
  renderPlayers();
  renderDash();
}
function toggleSelectAll() {
  if (state.selected.size === state.players.length) state.selected.clear();
  else state.players.forEach((p) => state.selected.add(p.id));
  persistSelection();
  renderPlayers();
  renderDash();
}

/* ================= GENERADOR DE EQUIPOS ================= */
function generateBalancedTeams(randomize) {
  const pool = state.players.filter((p) => state.selected.has(p.id));
  if (pool.length < 2) {
    toast('Selecciona al menos 2 convocados para generar equipos', 'error');
    return;
  }
  const best = bestSplit(pool, randomize);
  state.draft = {
    A: best.A.map((p) => String(p.id)),
    B: best.B.map((p) => String(p.id)),
    goals: {},
    mvpId: null,
    fecha: todayISO(),
    jornada: String(nextJornada()),
    notas: ''
  };
  pool.forEach((p) => { state.draft.goals[String(p.id)] = 0; });
  saveDraft();
  renderMatch();
  switchTab('partido');
  toast('Equipos listos: ' + best.A.length + ' vs ' + best.B.length, 'success');
}
function buildCandidate(pool) {
  const sortDesc = (arr) => arr
    .map((p) => ({ p, k: overall(p) + (Math.random() - 0.5) * 7 }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.p);
  const A = [];
  const B = [];
  const first = Math.random() < 0.5 ? A : B;
  sortDesc(pool.filter((p) => safePos(p.posicion) === 'POR')).forEach((p, i) => {
    (i % 2 === 0 ? first : (first === A ? B : A)).push(p);
  });
  const sum = (arr) => arr.reduce((acc, p) => acc + overall(p), 0);
  sortDesc(pool.filter((p) => safePos(p.posicion) !== 'POR')).forEach((p) => {
    if (A.length < B.length) A.push(p);
    else if (B.length < A.length) B.push(p);
    else (sum(A) <= sum(B) ? A : B).push(p);
  });
  return { A, B };
}
function teamScore(t) {
  const sum = (arr) => arr.reduce((acc, p) => acc + overall(p), 0);
  const ovrDiff = Math.abs(sum(t.A) - sum(t.B));
  const countDiff = Math.abs(t.A.length - t.B.length);
  let posPenalty = 0;
  ['POR', 'DEF', 'MED', 'DEL'].forEach((pos) => {
    const ca = t.A.filter((p) => safePos(p.posicion) === pos).length;
    const cb = t.B.filter((p) => safePos(p.posicion) === pos).length;
    posPenalty += Math.max(0, Math.abs(ca - cb) - 1);
  });
  return ovrDiff * 10 + countDiff * 12 + posPenalty * 4;
}
function bestSplit(pool, randomize) {
  let best = null;
  const attempts = randomize ? 260 : 420;
  for (let i = 0; i < attempts; i++) {
    const candidate = buildCandidate(pool);
    const score = teamScore(candidate);
    if (!best || score < best.score) best = Object.assign({}, candidate, { score });
  }
  return best;
}
function pruneDraft() {
  const valid = new Set(state.players.map((p) => String(p.id)));
  state.draft.A = state.draft.A.filter((id) => valid.has(String(id)));
  state.draft.B = state.draft.B.filter((id) => valid.has(String(id)));
  if (state.draft.mvpId && !valid.has(String(state.draft.mvpId))) state.draft.mvpId = null;
  state.selected = new Set([...state.selected].filter((id) => valid.has(String(id))));
}

/* ================= PESTAÑAS ================= */
function switchTab(tab) {
  const valid = ['plantilla', 'partido', 'historial', 'ranking'];
  const target = valid.includes(tab) ? tab : 'plantilla';
  $$('.section').forEach((s) => s.classList.toggle('active', s.id === 'sec-' + target));
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === target));
  lsSet(LS.tab, target);
  if (target === 'ranking') renderRanking();
  if (target === 'historial') renderHistory();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ================= RENDER DEL PARTIDO ================= */
function setIfIdle(sel, val) {
  const el = $(sel);
  if (!el || document.activeElement === el) return;
  el.value = val == null ? '' : val;
}
function renderTeamRow(p) {
  const id = esc(p.id);
  const goals = Number(state.draft.goals[String(p.id)]) || 0;
  const isMvp = String(state.draft.mvpId) === String(p.id);
  const pos = safePos(p.posicion);
  return '<div class="team-row">' +
    avatarImg(p, 'row-avatar', '') +
    '<div class="row-name"><b>' + esc(p.nombre) + '</b>' +
      '<small><span class="pos-tag pos-' + pos + '">' + pos + '</span> OVR ' + overall(p) + '</small>' +
    '</div>' +
    '<div class="row-actions">' +
      '<div class="stepper">' +
        '<button type="button" data-action="goal" data-dir="-1" data-id="' + id + '" aria-label="Quitar gol">−</button>' +
        '<span>⚽ ' + goals + '</span>' +
        '<button type="button" data-action="goal" data-dir="1" data-id="' + id + '" aria-label="Añadir gol">+</button>' +
      '</div>' +
      '<button class="mvp-toggle' + (isMvp ? ' active' : '') + '" type="button" data-action="mvp" data-id="' + id + '" title="Elegir MVP" aria-label="Elegir MVP">⭐</button>' +
    '</div>' +
  '</div>';
}
function renderMatch() {
  const teams = draftTeams();
  const ids = new Set([...teams.A, ...teams.B].map((p) => String(p.id)));
  Object.keys(state.draft.goals).forEach((id) => {
    if (!ids.has(String(id))) delete state.draft.goals[id];
  });
  const hasTeams = teams.A.length > 0 || teams.B.length > 0;
  const empty = $('#emptyMatch');
  const content = $('#matchContent');
  if (empty) empty.hidden = hasTeams;
  if (content) content.hidden = !hasTeams;
  const saveBtn = $('#btnSaveMatch');
  if (saveBtn) saveBtn.disabled = !hasTeams;
  if (!hasTeams) return;

  setIfIdle('#matchJornada', state.draft.jornada || nextJornada());
  setIfIdle('#matchFecha', state.draft.fecha || todayISO());
  setIfIdle('#matchNotas', state.draft.notas || '');

  const goalsOf = (team) => team.reduce((acc, p) => acc + (Number(state.draft.goals[String(p.id)]) || 0), 0);
  const sumOf = (team) => team.reduce((acc, p) => acc + overall(p), 0);
  const ga = goalsOf(teams.A);
  const gb = goalsOf(teams.B);
  const sa = sumOf(teams.A);
  const sb = sumOf(teams.B);
  const avgA = teams.A.length ? sa / teams.A.length : 0;
  const avgB = teams.B.length ? sb / teams.B.length : 0;
  const setText = (sel, val) => { const el = $(sel); if (el) el.textContent = val; };
  setText('#scoreA', ga);
  setText('#scoreB', gb);
  setText('#goalsA', ga);
  setText('#goalsB', gb);
  setText('#sumA', sa);
  setText('#sumB', sb);
  setText('#avgA', 'Media ' + (teams.A.length ? avgA.toFixed(1) : '–'));
  setText('#avgB', 'Media ' + (teams.B.length ? avgB.toFixed(1) : '–'));

  const total = sa + sb || 1;
  const fill = $('#balanceFill');
  if (fill) fill.style.width = Math.round((sa / total) * 100) + '%';
  const diff = Math.abs(avgA - avgB);
  const balanceText = diff < 0.4 ? 'Equilibrio perfecto' : 'Diferencia de ' + diff.toFixed(1) + ' OVR';
  setText('#balanceText', teams.A.length && teams.B.length ? balanceText : 'Faltan jugadores en un equipo');

  const listA = $('#listTeamA');
  const listB = $('#listTeamB');
  if (listA) listA.innerHTML = teams.A.map(renderTeamRow).join('');
  if (listB) listB.innerHTML = teams.B.map(renderTeamRow).join('');
}
function changeGoal(id, delta) {
  const key = String(id);
  if (!state.draft.A.includes(key) && !state.draft.B.includes(key)) return;
  const current = Number(state.draft.goals[key]) || 0;
  state.draft.goals[key] = Math.max(0, current + delta);
  saveDraft();
  renderMatch();
}
function toggleMvp(id) {
  const key = String(id);
  state.draft.mvpId = String(state.draft.mvpId) === key ? null : key;
  saveDraft();
  renderMatch();
}
function onMatchClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'goal') changeGoal(btn.dataset.id, Number(btn.dataset.dir));
  else if (btn.dataset.action === 'mvp') toggleMvp(btn.dataset.id);
}

/* ================= GUARDAR ACTA ================= */
async function commitDeltas(deltas, onProgress) {
  const failed = [];
  state.saving = true;
  const entries = [...deltas.entries()].filter(([, d]) => d.goles || d.mvp || d.partidos);
  let i = 0;
  for (const [id, d] of entries) {
    i++;
    if (onProgress) onProgress(i, entries.length);
    const p = playerById(id);
    if (!p) continue;
    const next = Object.assign({}, p, {
      goles: Math.max(0, Number(p.goles) + Number(d.goles || 0)),
      mvp: Math.max(0, Number(p.mvp) + Number(d.mvp || 0)),
      partidos: Math.max(0, Number(p.partidos) + Number(d.partidos || 0))
    });
    try {
      await patchPlayer(next);
      Object.assign(p, next);
    } catch (err) {
      console.warn('No se pudo actualizar a ' + p.nombre, err);
      failed.push({ id: String(id), goles: Number(d.goles || 0), mvp: Number(d.mvp || 0), partidos: Number(d.partidos || 0) });
    }
  }
  state.saving = false;
  writePlayerCache();
  renderPlayers();
  renderDash();
  renderRanking();
  return failed;
}
async function saveNewMatch() {
  const teams = draftTeams();
  if (!teams.A.length && !teams.B.length) {
    toast('Primero genera los equipos', 'error');
    return;
  }
  const fecha = ($('#matchFecha').value || todayISO());
  const notas = ($('#matchNotas').value || '').trim();
  const jornada = Number($('#matchJornada').value) || nextJornada();
  const [ga, gb] = matchScore({
    teamA: teams.A.map((p) => ({ id: p.id })),
    teamB: teams.B.map((p) => ({ id: p.id })),
    goals: state.draft.goals
  });
  const ok = await askConfirm({
    title: 'Guardar acta · Jornada ' + jornada,
    message: 'Resultado: Equipo A ' + ga + ' – ' + gb + ' Equipo B. Se sumarán los goles, el MVP y un partido jugado a cada convocado.',
    confirmText: 'Guardar acta'
  });
  if (!ok) return;

  const btn = $('#btnSaveMatch');
  const original = btn.textContent;
  btn.disabled = true;
  const deltas = new Map();
  [...teams.A, ...teams.B].forEach((p) => {
    const id = String(p.id);
    deltas.set(id, {
      goles: Number(state.draft.goals[id]) || 0,
      mvp: String(state.draft.mvpId) === id ? 1 : 0,
      partidos: 1
    });
  });
  try {
    const failed = await commitDeltas(deltas, (i, total) => { btn.textContent = 'Guardando ' + i + '/' + total + '…'; });
    const mvp = state.draft.mvpId ? playerById(state.draft.mvpId) : null;
    const goals = {};
    [...teams.A, ...teams.B].forEach((p) => { goals[String(p.id)] = Number(state.draft.goals[String(p.id)]) || 0; });
    const record = {
      id: uid('m'),
      jornada: jornada,
      fecha: fecha,
      notas: notas,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      teamA: teams.A.map((p) => ({ id: String(p.id), nombre: p.nombre })),
      teamB: teams.B.map((p) => ({ id: String(p.id), nombre: p.nombre })),
      goals: goals,
      mvpId: state.draft.mvpId || null,
      mvpNombre: mvp ? mvp.nombre : '',
      unsynced: failed
    };
    state.matches.push(record);
    persistMatches();
    pushMatchRemote(record);
    state.draft = blankDraft();
    lsDel(LS.draft);
    renderAll();
    switchTab('historial');
    if (failed.length) {
      toast('Acta guardada, pero ' + failed.length + ' jugador(es) no se sincronizaron. Reintenta desde el historial.', 'error', 6500);
    } else {
      toast('¡Acta guardada! J' + jornada + ' · ' + ga + '–' + gb, 'success');
    }
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar el acta. Revisa tu conexión.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}
function copyTeamsToClipboard() {
  const teams = draftTeams();
  if (!teams.A.length && !teams.B.length) {
    toast('Primero genera los equipos', 'error');
    return;
  }
  const avg = (team) => team.length ? (team.reduce((a, p) => a + overall(p), 0) / team.length).toFixed(1) : '–';
  let text = '⚽ *JOGO BONITO WALKING F.C.* ⚽\n*Convocatoria*\n\n';
  text += '🔴 *EQUIPO A* (media ' + avg(teams.A) + ')\n';
  teams.A.forEach((p) => { text += '• [' + safePos(p.posicion) + '] ' + p.nombre + ' (' + overall(p) + ')\n'; });
  text += '\n🔵 *EQUIPO B* (media ' + avg(teams.B) + ')\n';
  teams.B.forEach((p) => { text += '• [' + safePos(p.posicion) + '] ' + p.nombre + ' (' + overall(p) + ')\n'; });
  text += '\n📅 ' + fmtDate(state.draft.fecha) + ' · Jornada ' + (state.draft.jornada || nextJornada());
  if (state.draft.notas) text += '\n📝 ' + state.draft.notas;
  copyText(text, 'Convocatoria copiada para WhatsApp');
}

/* ================= HISTORIAL ================= */
function statCard(value, label) {
  return '<div class="stat-card"><b>' + esc(value) + '</b><small>' + esc(label) + '</small></div>';
}
function scorersHTML(m, team) {
  const arr = (team || [])
    .map((p) => ({ p: p, g: Number((m.goals || {})[p.id]) || 0 }))
    .filter((x) => x.g > 0)
    .sort((a, b) => b.g - a.g);
  if (!arr.length) return '<span class="muted">Sin goles</span>';
  return arr.map((x) => '<span class="scorer">' + esc(x.p.nombre) + '<b>×' + x.g + '</b></span>').join('');
}
function matchCardHTML(m) {
  const [ga, gb] = matchScore(m);
  const roster = [...(m.teamA || []), ...(m.teamB || [])];
  const mvpEntry = roster.find((p) => String(p.id) === String(m.mvpId));
  const mvpName = m.mvpNombre || (mvpEntry ? mvpEntry.nombre : '');
  const pending = Array.isArray(m.unsynced) ? m.unsynced.length : 0;
  return '<article class="match-card" data-id="' + esc(m.id) + '">' +
    '<div class="match-card-head">' +
      '<span class="jornada-pill">J' + esc(m.jornada || '?') + '</span>' +
      '<span class="match-date">' + esc(fmtDate(m.fecha)) + '</span>' +
      '<span class="match-score">A ' + ga + ' · ' + gb + ' B</span>' +
      '<div class="match-actions">' +
        '<button class="table-action" type="button" data-action="share-match" data-id="' + esc(m.id) + '" title="Copiar para WhatsApp">📲</button>' +
        '<button class="table-action" type="button" data-action="edit-match" data-id="' + esc(m.id) + '">✏️ Editar</button>' +
        '<button class="table-action" type="button" data-action="delete-match" data-id="' + esc(m.id) + '" title="Eliminar acta">🗑️</button>' +
      '</div>' +
    '</div>' +
    '<div class="match-teams">' +
      '<div class="match-team"><h4>Equipo A</h4><div class="scorers">' + scorersHTML(m, m.teamA) + '</div></div>' +
      '<div class="match-team"><h4>Equipo B</h4><div class="scorers">' + scorersHTML(m, m.teamB) + '</div></div>' +
    '</div>' +
    '<div class="match-footer">' +
      (mvpName ? '<span class="mvp-chip">⭐ MVP · ' + esc(mvpName) + '</span>' : '') +
      (m.notas ? '<span class="match-notes" title="' + esc(m.notas) + '">📝 ' + esc(m.notas) + '</span>' : '') +
      '<span style="margin-left:auto">' + roster.length + ' jugadores</span>' +
    '</div>' +
    (pending ? '<div class="match-warning">⚠ ' + pending + ' registro(s) pendientes de sincronizar' +
      '<button class="table-action" type="button" data-action="retry-match" data-id="' + esc(m.id) + '">Reintentar</button></div>' : '') +
  '</article>';
}
function renderHistory() {
  const list = $('#historyList');
  if (!list) return;
  const sorted = matchesSorted(true);
  let totalGoals = 0;
  state.matches.forEach((m) => {
    const [a, b] = matchScore(m);
    totalGoals += a + b;
  });
  const mvps = state.matches.filter((m) => m.mvpId).length;
  const stats = $('#historyStats');
  if (stats) {
    stats.innerHTML = [
      statCard(state.matches.length, 'Actas'),
      statCard(totalGoals, 'Goles'),
      statCard(mvps, 'MVPs'),
      statCard(state.matches.length ? (totalGoals / state.matches.length).toFixed(1) : '–', 'Goles / acta')
    ].join('');
  }
  const empty = $('#historyEmpty');
  if (empty) empty.hidden = sorted.length > 0;
  list.innerHTML = sorted.map(matchCardHTML).join('');
  const hint = $('#historyStorageHint');
  if (hint) {
    if (store.matchesApi) {
      const sheet = esc(store.matchesSheet || 'Partidos');
      hint.innerHTML = state.matchesRemoteOk === false
        ? '⚠️ No se pudo sincronizar con la pestaña <b>«' + sheet + '»</b>. Revisa que exista y tenga las cabeceras <code>id, jornada, fecha, data</code>. ' +
          '<button class="table-action" type="button" onclick="openSettings()">Ajustes</button>'
        : state.matchesRemoteOk === null
          ? '⏳ Conectando con la pestaña <b>«' + sheet + '»</b>…'
          : '☁️ Historial sincronizado con la pestaña <b>«' + sheet + '»</b> de tu Google Sheets.';
    } else {
      hint.innerHTML = '💾 Historial guardado solo en este dispositivo. ' +
        '<button class="table-action" type="button" onclick="openSettings()">Activar sincronización</button>';
    }
  }
}
function shareMatch(id) {
  const m = state.matches.find((x) => String(x.id) === String(id));
  if (!m) return;
  const [ga, gb] = matchScore(m);
  let text = '⚽ *JOGO BONITO WALKING F.C.* ⚽\n*Jornada ' + (m.jornada || '?') + ' · ' + fmtDate(m.fecha) + '*\n\n';
  text += '🔴 Equipo A ' + ga + ' – ' + gb + ' Equipo B 🔵\n\n';
  const line = (team) => (team || []).map((p) => {
    const g = Number((m.goals || {})[p.id]) || 0;
    const mvp = String(m.mvpId) === String(p.id) ? ' ⭐' : '';
    return '• ' + p.nombre + (g ? ' ⚽' + g : '') + mvp;
  }).join('\n');
  text += '*Equipo A*\n' + line(m.teamA) + '\n\n*Equipo B*\n' + line(m.teamB) + '\n';
  if (m.notas) text += '\n📝 ' + m.notas;
  copyText(text, 'Acta copiada para WhatsApp');
}
async function onHistoryClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === 'edit-match') openMatchEditor(id);
  else if (action === 'delete-match') deleteMatch(id);
  else if (action === 'share-match') shareMatch(id);
  else if (action === 'retry-match') retryMatchUnsynced(id, false);
}

/* ================= SINCRONIZACIÓN DE ACTAS ================= */
function warnRemoteOnce() {
  if (state.remoteWarned) return;
  state.remoteWarned = true;
  state.matchesRemoteOk = false;
  renderHistory();
  const where = store.matchesSheet ? 'la pestaña «' + store.matchesSheet + '»' : 'la hoja de actas';
  toast('El acta se guardó en este dispositivo, pero no se pudo escribir en ' + where + '. Revisa el nombre de la pestaña y las cabeceras (id, jornada, fecha, data).', 'error', 8000);
}
async function pushMatchRemote(m) {
  const url = store.matchesApi;
  if (!url) return false;
  if (readDeletedIds().includes(String(m.id))) return false;
  const row = {
    id: String(m.id),
    jornada: String(m.jornada || ''),
    fecha: String(m.fecha || ''),
    data: JSON.stringify(m)
  };
  try {
    if (state.remoteMatchIds.has(String(m.id))) {
      const res = await fetch(apiIdUrl(url, m.id), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: row })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
    } else {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [row] })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.remoteMatchIds.add(String(m.id));
    }
    state.remoteWarned = false;
    return true;
  } catch (err) {
    console.warn('No se pudo subir el acta a la nube', err);
    warnRemoteOnce();
    return false;
  }
}
async function deleteMatchRemote(id) {
  const url = store.matchesApi;
  if (!url) return;
  try {
    await fetch(apiIdUrl(url, id), { method: 'DELETE' });
    state.remoteMatchIds.delete(String(id));
  } catch (err) {
    console.warn('No se pudo borrar el acta remota', err);
  }
}
async function syncMatchesRemote(silent) {
  const url = store.matchesApi;
  if (!url) {
    state.matchesRemoteOk = null;
    if (!silent) toast('Configura la pestaña de actas en ⚙ Ajustes', 'error');
    return;
  }
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Respuesta inesperada');
    state.matchesRemoteOk = true;
    state.remoteMatchIds = new Set();
    const deleted = new Set(readDeletedIds());
    const merged = new Map(state.matches.map((m) => [String(m.id), m]));
    rows.forEach((r) => {
      const id = String(r.id || '');
      if (!id) return;
      state.remoteMatchIds.add(id);
      if (deleted.has(id)) { deleteMatchRemote(id); return; }
      let parsed = null;
      if (r.data) { try { parsed = JSON.parse(r.data); } catch (err) { parsed = null; } }
      if (!parsed || typeof parsed !== 'object') return;
      parsed.id = String(parsed.id || id);
      const local = merged.get(String(parsed.id));
      if (!local || Number(parsed.updatedAt || 0) >= Number(local.updatedAt || 0)) {
        merged.set(String(parsed.id), parsed);
      }
    });
    deleted.forEach((id) => merged.delete(id));
    state.matches = [...merged.values()].filter((m) => !deleted.has(String(m.id)));
    persistMatches();
    for (const m of state.matches) {
      if (!state.remoteMatchIds.has(String(m.id))) await pushMatchRemote(m);
    }
    renderHistory();
    renderDash();
    renderRanking();
    renderMatch();
    if (!silent) toast('Historial sincronizado', 'success');
  } catch (err) {
    console.warn('No se pudo sincronizar el historial', err);
    state.matchesRemoteOk = false;
    renderHistory();
    if (!silent) {
      const where = store.matchesSheet ? 'la pestaña «' + store.matchesSheet + '»' : 'la hoja de actas';
      toast('No se pudo leer ' + where + '. Revisa que exista y tenga las cabeceras id, jornada, fecha, data.', 'error', 8000);
    }
  }
}
async function probeMatchesApi() {
  const url = store.matchesApi;
  if (!url) return { ok: false, reason: 'sin hoja configurada' };
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: 'HTTP ' + res.status };
    const rows = await res.json();
    if (!Array.isArray(rows)) return { ok: false, reason: 'respuesta inesperada' };
    return { ok: true, rows: rows.length };
  } catch (err) {
    return { ok: false, reason: 'sin conexión' };
  }
}
async function retryMatchUnsynced(id, silent) {
  const m = state.matches.find((x) => String(x.id) === String(id));
  if (!m || !Array.isArray(m.unsynced) || !m.unsynced.length) return;
  const remaining = [];
  for (const d of m.unsynced) {
    const p = playerById(d.id);
    if (!p) continue;
    const next = Object.assign({}, p, {
      goles: Math.max(0, Number(p.goles) + Number(d.goles || 0)),
      mvp: Math.max(0, Number(p.mvp) + Number(d.mvp || 0)),
      partidos: Math.max(0, Number(p.partidos) + Number(d.partidos || 0))
    });
    try {
      await patchPlayer(next);
      Object.assign(p, next);
    } catch (err) {
      remaining.push(d);
    }
  }
  m.unsynced = remaining;
  persistMatches();
  writePlayerCache();
  renderAll();
  if (!silent) {
    toast(remaining.length ? 'Siguen quedando datos pendientes' : 'Sincronización completada', remaining.length ? 'error' : 'success');
  }
}
async function retryAllUnsynced() {
  const ids = state.matches
    .filter((m) => Array.isArray(m.unsynced) && m.unsynced.length)
    .map((m) => m.id);
  for (const id of ids) {
    try { await retryMatchUnsynced(id, true); } catch (err) { /* siguiente */ }
  }
}

/* ================= EDITOR DE ACTA ================= */
async function openMatchEditor(id) {
  let m = state.matches.find((x) => String(x.id) === String(id));
  if (!m) return;
  if (Array.isArray(m.unsynced) && m.unsynced.length) {
    await retryMatchUnsynced(m.id, true);
    m = state.matches.find((x) => String(x.id) === String(id));
    if (!m) return;
    if (Array.isArray(m.unsynced) && m.unsynced.length) {
      toast('Primero sincroniza los datos pendientes de esta acta', 'error');
      return;
    }
  }
  state.editingMatchId = String(id);
  state.editingMatch = JSON.parse(JSON.stringify(m));
  const em = state.editingMatch;
  if (!Array.isArray(em.teamA)) em.teamA = [];
  if (!Array.isArray(em.teamB)) em.teamB = [];
  if (!em.goals || typeof em.goals !== 'object') em.goals = {};
  $('#editJornada').value = em.jornada || nextJornada();
  $('#editFecha').value = em.fecha || todayISO();
  $('#editNotas').value = em.notas || '';
  renderMatchEditor();
  openModal('matchModal');
}
function editRowHTML(p) {
  const id = esc(p.id);
  const goals = Number((state.editingMatch.goals || {})[p.id]) || 0;
  const current = playerById(p.id);
  return '<div class="edit-row">' +
    '<div class="edit-name">' + esc(p.nombre) +
      '<small>' + (current ? safePos(current.posicion) + ' · OVR ' + overall(current) : 'Fuera de plantilla') + '</small>' +
    '</div>' +
    '<div class="stepper">' +
      '<button type="button" data-action="egoal" data-dir="-1" data-id="' + id + '" aria-label="Quitar gol">−</button>' +
      '<span>⚽ ' + goals + '</span>' +
      '<button type="button" data-action="egoal" data-dir="1" data-id="' + id + '" aria-label="Añadir gol">+</button>' +
    '</div>' +
    '<button class="table-action" type="button" data-action="eremove" data-id="' + id + '" title="Quitar del acta">✕</button>' +
  '</div>';
}
function renderMatchEditor() {
  const m = state.editingMatch;
  if (!m) return;
  const roster = [...(m.teamA || []), ...(m.teamB || [])];
  const [ga, gb] = matchScore(m);
  $('#editScoreA').textContent = ga;
  $('#editScoreB').textContent = gb;
  $('#editListA').innerHTML = (m.teamA || []).map(editRowHTML).join('') || '<p class="hint small">Sin jugadores</p>';
  $('#editListB').innerHTML = (m.teamB || []).map(editRowHTML).join('') || '<p class="hint small">Sin jugadores</p>';

  const mvpSelect = $('#editMvp');
  mvpSelect.innerHTML = '<option value="">Sin MVP</option>' + roster
    .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.nombre) + '</option>').join('');
  mvpSelect.value = m.mvpId && roster.some((p) => String(p.id) === String(m.mvpId)) ? String(m.mvpId) : '';

  const inRoster = new Set(roster.map((p) => String(p.id)));
  const available = state.players.filter((p) => !inRoster.has(String(p.id)));
  const addSelect = $('#editAddPlayer');
  addSelect.innerHTML = available.length
    ? available.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.nombre) + ' · ' + safePos(p.posicion) + '</option>').join('')
    : '<option value="">No quedan jugadores</option>';
  addSelect.disabled = !available.length;
  $('#btnAddA').disabled = !available.length;
  $('#btnAddB').disabled = !available.length;
}
function removeFromEditor(id) {
  const m = state.editingMatch;
  if (!m) return;
  m.teamA = (m.teamA || []).filter((p) => String(p.id) !== String(id));
  m.teamB = (m.teamB || []).filter((p) => String(p.id) !== String(id));
  delete m.goals[String(id)];
  if (String(m.mvpId) === String(id)) m.mvpId = null;
  renderMatchEditor();
}
function addToEditor(teamKey) {
  const m = state.editingMatch;
  if (!m) return;
  const id = $('#editAddPlayer').value;
  if (!id) { toast('No hay jugadores disponibles', 'error'); return; }
  const p = playerById(id);
  if (!p) return;
  const inRoster = [...(m.teamA || []), ...(m.teamB || [])].some((x) => String(x.id) === String(id));
  if (inRoster) return;
  m[teamKey].push({ id: String(p.id), nombre: p.nombre });
  m.goals[String(p.id)] = 0;
  renderMatchEditor();
}
async function saveMatchEdits() {
  const m = state.editingMatch;
  if (!m) return;
  const original = state.matches.find((x) => String(x.id) === String(m.id));
  if (!original) return;
  m.fecha = $('#editFecha').value || todayISO();
  m.jornada = Number($('#editJornada').value) || Number(original.jornada) || 1;
  m.notas = ($('#editNotas').value || '').trim();
  m.mvpId = $('#editMvp').value || null;
  [...m.teamA, ...m.teamB].forEach((p) => {
    const current = playerById(p.id);
    if (current) p.nombre = current.nombre;
  });
  const mvpEntry = [...m.teamA, ...m.teamB].find((p) => String(p.id) === String(m.mvpId));
  m.mvpId = mvpEntry ? String(mvpEntry.id) : null;
  m.mvpNombre = mvpEntry ? mvpEntry.nombre : '';

  const deltas = diffStats(statsMap(original), statsMap(m));
  const btn = $('#btnSaveEdits');
  const label = btn.textContent;
  btn.disabled = true;
  try {
    const failed = await commitDeltas(deltas, (i, total) => { btn.textContent = 'Guardando ' + i + '/' + total + '…'; });
    m.updatedAt = Date.now();
    m.unsynced = failed;
    const index = state.matches.findIndex((x) => String(x.id) === String(m.id));
    if (index >= 0) state.matches[index] = m;
    persistMatches();
    pushMatchRemote(m);
    state.editingMatch = null;
    state.editingMatchId = null;
    closeModal('matchModal');
    renderAll();
    if (failed.length) toast('Cambios guardados con ' + failed.length + ' pendiente(s)', 'error', 6500);
    else toast('Acta actualizada y estadísticas recalculadas', 'success');
  } catch (err) {
    console.error(err);
    toast('No se pudieron guardar los cambios', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
function onEditorListClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn || !state.editingMatch) return;
  const id = String(btn.dataset.id);
  if (btn.dataset.action === 'egoal') {
    const next = Math.max(0, (Number(state.editingMatch.goals[id]) || 0) + Number(btn.dataset.dir));
    state.editingMatch.goals[id] = next;
    renderMatchEditor();
  } else if (btn.dataset.action === 'eremove') {
    removeFromEditor(id);
  }
}
async function deleteMatch(id) {
  const m = state.matches.find((x) => String(x.id) === String(id));
  if (!m) return;
  if (Array.isArray(m.unsynced) && m.unsynced.length) {
    await retryMatchUnsynced(m.id, true);
    if (Array.isArray(m.unsynced) && m.unsynced.length) {
      toast('No se puede eliminar: hay datos pendientes de sincronizar', 'error');
      return;
    }
  }
  const [ga, gb] = matchScore(m);
  const ok = await askConfirm({
    title: 'Eliminar acta · Jornada ' + (m.jornada || '?'),
    message: 'Se borrará el partido del ' + fmtDate(m.fecha) + ' (A ' + ga + ' – ' + gb + ' B) y se restarán sus goles, MVPs y partidos jugados.',
    confirmText: 'Eliminar acta',
    danger: true
  });
  if (!ok) return;
  const map = statsMap(m);
  const deltas = new Map();
  map.forEach((v, pid) => deltas.set(pid, { goles: -v.goles, mvp: -v.mvp, partidos: -v.partidos }));
  try {
    await commitDeltas(deltas);
    state.matches = state.matches.filter((x) => String(x.id) !== String(id));
    persistMatches();
    markDeletedId(id);
    deleteMatchRemote(id);
    renderAll();
    toast('Acta eliminada', 'success');
  } catch (err) {
    console.error(err);
    toast('No se pudo eliminar el acta', 'error');
  }
}

/* ================= RANKING ================= */
function sortValue(p, key) {
  switch (key) {
    case 'nombre': return p.nombre.toLowerCase();
    case 'posicion': return safePos(p.posicion);
    case 'ovr': return overall(p);
    case 'goles': return Number(p.goles) || 0;
    case 'mvp': return Number(p.mvp) || 0;
    case 'partidos': return Number(p.partidos) || 0;
    case 'ratio': return Number(p.partidos) ? (Number(p.goles) || 0) / Number(p.partidos) : 0;
    default: return 0;
  }
}
function renderRanking() {
  const podium = $('#podium');
  if (!podium) return;
  const byGoals = [...state.players].sort((a, b) =>
    (Number(b.goles) || 0) - (Number(a.goles) || 0) ||
    (Number(b.mvp) || 0) - (Number(a.mvp) || 0) ||
    overall(b) - overall(a)
  ).slice(0, 3);
  podium.innerHTML = byGoals.length
    ? byGoals.map((p, i) => {
      const medals = ['🥇', '🥈', '🥉'];
      return '<button class="podium-card p' + (i + 1) + '" type="button" data-player="' + esc(p.id) + '">' +
        '<span class="medal">' + medals[i] + '</span>' +
        avatarImg(p, 'podium-avatar', '') +
        '<span class="podium-name">' + esc(p.nombre) + '</span>' +
        '<span class="podium-goals"><b>' + p.goles + '</b> goles · ' + p.mvp + ' MVP</span>' +
      '</button>';
    }).join('')
    : '<div class="stat-card" style="grid-column:1/-1"><b>–</b><small>Sin datos todavía</small></div>';

  let totalGoals = 0;
  let totalMvp = 0;
  state.players.forEach((p) => { totalGoals += Number(p.goles) || 0; totalMvp += Number(p.mvp) || 0; });
  const avgOvr = state.players.length
    ? (state.players.reduce((a, p) => a + overall(p), 0) / state.players.length).toFixed(1)
    : '–';
  const stats = $('#rankStats');
  if (stats) {
    stats.innerHTML = [
      statCard(totalGoals, 'Goles totales'),
      statCard(totalMvp, 'MVPs'),
      statCard(state.matches.length, 'Actas'),
      statCard(avgOvr, 'Media OVR')
    ].join('');
  }

  const q = state.rankQuery.trim().toLowerCase();
  const list = state.players.filter((p) => !q || p.nombre.toLowerCase().includes(q));
  const sort = state.rankSort;
  list.sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va < vb) return -sort.dir;
    if (va > vb) return sort.dir;
    return (Number(b.goles) || 0) - (Number(a.goles) || 0);
  });
  const tbody = $('#rankingBody');
  if (tbody) {
    tbody.innerHTML = list.map((p, index) => {
      const ovr = overall(p);
      const pos = safePos(p.posicion);
      const ratio = Number(p.partidos) ? (Number(p.goles) / Number(p.partidos)).toFixed(2) : '–';
      return '<tr>' +
        '<td><span class="rank-num' + (index < 3 ? ' top' : '') + '">#' + (index + 1) + '</span></td>' +
        '<td><div class="stats-player-cell">' + avatarImg(p, '', '') + '<span>' + esc(p.nombre) + '</span></div></td>' +
        '<td class="hide-sm"><span class="pos-tag pos-' + pos + '">' + pos + '</span></td>' +
        '<td><b>' + ovr + '</b></td>' +
        '<td><b style="color:var(--brand)">' + p.goles + '</b></td>' +
        '<td>' + p.mvp + '</td>' +
        '<td class="hide-sm">' + p.partidos + '</td>' +
        '<td class="hide-sm">' + ratio + '</td>' +
        '<td class="hide-sm">' + formaHTML(p.id) + '</td>' +
        '<td><button class="table-action" type="button" data-action="edit-player" data-id="' + esc(p.id) + '">Ficha</button></td>' +
      '</tr>';
    }).join('');
  }
  $$('#rankTable thead th[data-sort]').forEach((th) => {
    const active = th.dataset.sort === sort.key;
    th.classList.toggle('active', active);
    if (active) th.dataset.dir = String(sort.dir);
    else delete th.dataset.dir;
  });
  const empty = $('#rankEmpty');
  if (empty) empty.hidden = state.players.length > 0;
}

/* ================= FICHA DE JUGADOR ================= */
function attrValue(id) {
  const el = document.getElementById(id);
  const n = Number(el.value);
  return Math.max(1, Math.min(99, isNaN(n) ? 60 : n));
}
function updateLiveOvr() {
  const ids = ['attrPac', 'attrSho', 'attrPas', 'attrDri', 'attrDef', 'attrPhy'];
  const total = ids.reduce((acc, id) => acc + attrValue(id), 0);
  const el = $('#ovrLive');
  if (el) el.textContent = Math.round(total / ids.length);
}
function setAttrs(values) {
  const map = { attrPac: 'pac', attrSho: 'sho', attrPas: 'pas', attrDri: 'dri', attrDef: 'def', attrPhy: 'phy' };
  Object.keys(map).forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const n = Number(values[map[id]]);
    el.value = n ? n : 60;
  });
  updateLiveOvr();
}
function applyPosPreset() {
  const pos = safePos($('#playerPos').value);
  setAttrs(POS_PRESETS[pos]);
  toast('Atributos ajustados a ' + pos, 'info', 2200);
}
function updatePhotoPreview() {
  const box = $('#photoPreviewBox');
  const img = $('#photoPreviewImg');
  if (state.photo) {
    img.src = state.photo;
    box.hidden = false;
  } else {
    box.hidden = true;
    img.removeAttribute('src');
  }
}
function onPhotoChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      const size = 180;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const minSide = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - minSide) / 2, (img.height - minSide) / 2, minSide, minSide, 0, 0, size, size);
      state.photo = canvas.toDataURL('image/jpeg', 0.72);
      updatePhotoPreview();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}
function renderProfile(player) {
  const block = $('#playerProfile');
  if (!player) {
    block.hidden = true;
    block.innerHTML = '';
    return;
  }
  block.hidden = false;
  const recent = recentMatchesFor(player.id, 5);
  const rows = recent.map((m) => {
    const [ga, gb] = matchScore(m);
    const inA = (m.teamA || []).some((p) => String(p.id) === String(player.id));
    const goals = Number((m.goals || {})[String(player.id)]) || 0;
    const isMvp = String(m.mvpId) === String(player.id);
    const score = inA ? ga + '–' + gb : gb + '–' + ga;
    return '<div class="profile-row"><span>J' + esc(m.jornada || '?') + '</span>' +
      '<b>Equipo ' + (inA ? 'A' : 'B') + ' · ' + esc(score) + '</b>' +
      '<em>' + (goals ? '⚽' + goals : '') + (isMvp ? ' ⭐' : '') + '</em></div>';
  }).join('');
  block.innerHTML = '<h4>Trayectoria</h4>' +
    '<div class="profile-stats">' +
      '<div class="profile-stat"><b>' + player.partidos + '</b><small>PJ</small></div>' +
      '<div class="profile-stat"><b>' + player.goles + '</b><small>Goles</small></div>' +
      '<div class="profile-stat"><b>' + player.mvp + '</b><small>MVP</small></div>' +
      '<div class="profile-stat"><b>' + (Number(player.partidos) ? (Number(player.goles) / Number(player.partidos)).toFixed(2) : '–') + '</b><small>G/P</small></div>' +
    '</div>' +
    '<div class="profile-history">' +
      (rows || '<p class="hint small">' + (Number(player.partidos) > 0
        ? 'Sus partidos anteriores no tienen acta guardada. Los nuevos aparecerán aquí.'
        : 'Todavía no ha jugado ninguna acta.') + '</p>') +
    '</div>';
}
function openPlayerModal(id) {
  const player = id ? playerById(id) : null;
  state.editingPlayerId = player ? String(player.id) : null;
  state.photo = player ? (player.foto || '') : '';
  $('#playerModalTitle').textContent = player ? '✏️ Ficha de ' + player.nombre : '➕ Nuevo fichaje';
  $('#playerModalSubtitle').textContent = player
    ? 'Edita sus datos, atributos y consulta su trayectoria.'
    : 'Añade un veterano a la plantilla. Los atributos se pueden ajustar solos según la posición.';
  $('#playerName').value = player ? player.nombre : '';
  $('#playerPos').value = player ? safePos(player.posicion) : 'MED';
  setAttrs(player || POS_PRESETS.MED);
  $('#playerPhoto').value = '';
  const statsEditor = $('#statsEditor');
  if (statsEditor) {
    statsEditor.hidden = !player;
    if (player) {
      $('#statGoles').value = player.goles;
      $('#statMvp').value = player.mvp;
      $('#statPartidos').value = player.partidos;
    }
  }
  updatePhotoPreview();
  renderProfile(player);
  openModal('playerModal');
  setTimeout(() => { try { $('#playerName').focus(); } catch (err) { /* nada */ } }, 80);
}
async function savePlayerForm() {
  const nombre = $('#playerName').value.trim();
  if (!nombre) {
    toast('Introduce un nombre o apodo', 'error');
    $('#playerName').focus();
    return;
  }
  const posicion = safePos($('#playerPos').value);
  const attrs = {
    pac: attrValue('attrPac'),
    sho: attrValue('attrSho'),
    pas: attrValue('attrPas'),
    dri: attrValue('attrDri'),
    def: attrValue('attrDef'),
    phy: attrValue('attrPhy')
  };
  const btn = $('#btnSavePlayer');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Guardando…';
  try {
    if (state.editingPlayerId) {
      const player = playerById(state.editingPlayerId);
      if (!player) throw new Error('Jugador no encontrado');
      const next = Object.assign({}, player, { nombre: nombre, posicion: posicion, foto: state.photo }, attrs);
      if (!$('#statsEditor').hidden) {
        next.goles = Math.max(0, Number($('#statGoles').value) || 0);
        next.mvp = Math.max(0, Number($('#statMvp').value) || 0);
        next.partidos = Math.max(0, Number($('#statPartidos').value) || 0);
      }
      await patchPlayer(next);
      Object.assign(player, next);
      state.matches.forEach((m) => {
        [...(m.teamA || []), ...(m.teamB || [])].forEach((entry) => {
          if (String(entry.id) === String(player.id)) entry.nombre = nombre;
        });
        if (String(m.mvpId) === String(player.id)) m.mvpNombre = nombre;
      });
      persistMatches();
      writePlayerCache();
      renderAll();
      toast('Ficha actualizada', 'success');
    } else {
      const newPlayer = Object.assign({
        id: String(Date.now()) + Math.floor(Math.random() * 90 + 10),
        nombre: nombre,
        posicion: posicion,
        foto: state.photo,
        goles: 0,
        mvp: 0,
        partidos: 0
      }, attrs);
      await postPlayer(newPlayer);
      state.players.push(newPlayer);
      state.selected.add(String(newPlayer.id));
      writePlayerCache();
      persistSelection();
      renderAll();
      toast('¡Fichaje cerrado!', 'success');
    }
    closeModal('playerModal');
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar en Google Sheets. Revisa la conexión.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
async function deletePlayer(id) {
  const player = playerById(id);
  if (!player) return;
  const ok = await askConfirm({
    title: 'Eliminar a ' + player.nombre,
    message: 'Saldrá de la plantilla y de las convocatorias. Sus actas y su historial se conservan.',
    confirmText: 'Eliminar',
    danger: true
  });
  if (!ok) return;
  try {
    await deletePlayerRemote(player);
    state.players = state.players.filter((p) => String(p.id) !== String(id));
    state.selected.delete(String(id));
    state.draft.A = state.draft.A.filter((x) => String(x) !== String(id));
    state.draft.B = state.draft.B.filter((x) => String(x) !== String(id));
    delete state.draft.goals[String(id)];
    if (String(state.draft.mvpId) === String(id)) state.draft.mvpId = null;
    writePlayerCache();
    persistSelection();
    saveDraft();
    renderAll();
    toast('Jugador eliminado', 'success');
  } catch (err) {
    console.error(err);
    toast('No se pudo eliminar el jugador', 'error');
  }
}

/* ================= AJUSTES / COPIA DE SEGURIDAD ================= */
function updateMatchesPreview() {
  const el = $('#setMatchesPreview');
  if (!el) return;
  const playersUrl = $('#setPlayersApi').value.trim() || DEFAULT_PLAYERS_API;
  const sheet = $('#setMatchesSheet').value.trim();
  const override = $('#setMatchesApi').value.trim();
  if (override) {
    el.textContent = 'Se usará la URL avanzada: ' + override;
  } else if (!sheet) {
    el.textContent = 'Sincronización desactivada: el historial se guardará solo en este dispositivo.';
  } else {
    el.textContent = 'URL derivada: ' + apiWithSheet(playersUrl, sheet);
  }
}
function openSettings() {
  $('#setPlayersApi').value = lsGet(LS.playersApi) || '';
  $('#setMatchesSheet').value = store.matchesSheet;
  $('#setMatchesApi').value = lsGet(LS.matchesApi) || '';
  updateMatchesPreview();
  openModal('settingsModal');
}
async function saveSettings() {
  const playersUrl = $('#setPlayersApi').value.trim();
  const sheet = $('#setMatchesSheet').value.trim();
  const override = $('#setMatchesApi').value.trim();
  if (playersUrl && !/^https?:\/\//i.test(playersUrl)) {
    toast('La URL de la plantilla no parece válida', 'error');
    return;
  }
  if (override && !/^https?:\/\//i.test(override)) {
    toast('La URL avanzada de actas no parece válida', 'error');
    return;
  }
  store.playersApi = playersUrl;
  store.matchesSheet = sheet;
  store.matchesApi = override;
  state.remoteMatchIds = new Set();
  state.remoteWarned = false;
  state.matchesRemoteOk = null;
  closeModal('settingsModal');
  toast('Conexión guardada', 'success');
  await fetchPlayers(true);
  if (!store.matchesApi) {
    toast('Historial en modo local. Escribe «Partidos» para sincronizarlo con tu hoja.', 'info', 6000);
    return;
  }
  const probe = await probeMatchesApi();
  if (!probe.ok) {
    state.matchesRemoteOk = false;
    renderHistory();
    const where = sheet || 'Partidos';
    toast('No se pudo leer la pestaña «' + where + '» (' + probe.reason + '). Revisa que exista y tenga las cabeceras id, jornada, fecha, data.', 'error', 9000);
    return;
  }
  await syncMatchesRemote(true);
}
function exportBackup() {
  const payload = {
    exportedAt: new Date().toISOString(),
    players: state.players,
    matches: state.matches
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'jogo-bonito-backup-' + todayISO() + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
  toast('Copia de seguridad descargada', 'success');
}

/* ================= EVENTOS ================= */
function bindEvents() {
  $$('.tab-btn').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  $('#searchInput').addEventListener('input', (e) => { state.search = e.target.value; renderPlayers(); });
  $('#posChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-pos]');
    if (!chip) return;
    state.posFilter = chip.dataset.pos;
    $$('#posChips .chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderPlayers();
  });
  $('#btnSelectAll').addEventListener('click', toggleSelectAll);
  $('#btnNewPlayer').addEventListener('click', () => openPlayerModal(null));
  $('#btnGenerate').addEventListener('click', () => generateBalancedTeams(false));
  $('#playersGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.player-card');
    if (!card) return;
    const action = e.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'edit') openPlayerModal(card.dataset.id);
      else if (action.dataset.action === 'delete') deletePlayer(card.dataset.id);
      return;
    }
    togglePlayerSelection(card.dataset.id);
  });

  $('#matchJornada').addEventListener('change', (e) => { state.draft.jornada = e.target.value; saveDraft(); });
  $('#matchFecha').addEventListener('change', (e) => { state.draft.fecha = e.target.value || todayISO(); saveDraft(); });
  $('#matchNotas').addEventListener('input', (e) => { state.draft.notas = e.target.value; saveDraft(); });
  $('#btnShuffle').addEventListener('click', () => generateBalancedTeams(true));
  $('#btnWhatsapp').addEventListener('click', copyTeamsToClipboard);
  $('#btnSaveMatch').addEventListener('click', saveNewMatch);
  $('#listTeamA').addEventListener('click', onMatchClick);
  $('#listTeamB').addEventListener('click', onMatchClick);

  $('#historyList').addEventListener('click', onHistoryClick);
  $('#btnSyncMatches').addEventListener('click', () => syncMatchesRemote(false));

  $('#editListA').addEventListener('click', onEditorListClick);
  $('#editListB').addEventListener('click', onEditorListClick);
  $('#btnAddA').addEventListener('click', () => addToEditor('teamA'));
  $('#btnAddB').addEventListener('click', () => addToEditor('teamB'));
  $('#btnSaveEdits').addEventListener('click', saveMatchEdits);
  $('#editMvp').addEventListener('change', (e) => {
    if (state.editingMatch) state.editingMatch.mvpId = e.target.value || null;
  });

  $('#rankSearch').addEventListener('input', (e) => { state.rankQuery = e.target.value; renderRanking(); });
  const rankHead = $('#rankTable').querySelector('thead');
  rankHead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (state.rankSort.key === key) {
      state.rankSort.dir *= -1;
    } else {
      state.rankSort = { key: key, dir: (key === 'nombre' || key === 'posicion') ? 1 : -1 };
    }
    renderRanking();
  });
  $('#podium').addEventListener('click', (e) => {
    const card = e.target.closest('[data-player]');
    if (!card) return;
    openPlayerModal(card.dataset.player);
  });
  $('#rankingBody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="edit-player"]');
    if (!btn) return;
    openPlayerModal(btn.dataset.id);
  });

  $('#playerPhoto').addEventListener('change', onPhotoChange);
  $('#btnClearPhoto').addEventListener('click', () => {
    state.photo = '';
    $('#playerPhoto').value = '';
    updatePhotoPreview();
  });
  $('#btnSavePlayer').addEventListener('click', savePlayerForm);
  $('#btnPosPreset').addEventListener('click', applyPosPreset);
  $$('#playerModal input[type="number"]').forEach((input) => input.addEventListener('input', updateLiveOvr));

  $('#btnRefresh').addEventListener('click', () => fetchPlayers(true));
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnSaveSettings').addEventListener('click', saveSettings);
  ['#setPlayersApi', '#setMatchesSheet', '#setMatchesApi'].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener('input', updateMatchesPreview);
  });
  $('#btnRetryLoad').addEventListener('click', () => fetchPlayers(true));
  $('#syncPill').addEventListener('click', () => fetchPlayers(true));
  $('#confirmOk').addEventListener('click', () => resolveConfirm(true));
  $('#confirmCancel').addEventListener('click', () => resolveConfirm(false));

  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) closeModal(closer.dataset.close);
    const overlay = e.target.closest('.modal-overlay');
    if (overlay && e.target === overlay) {
      if (overlay.id === 'confirmModal') resolveConfirm(false);
      else closeModal(overlay.id);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const confirmBox = document.getElementById('confirmModal');
    if (confirmBox && confirmBox.classList.contains('open')) { resolveConfirm(false); return; }
    const open = $$('.modal-overlay.open').pop();
    if (open) closeModal(open.id);
  });
  window.addEventListener('online', () => {
    state.online = true;
    setSyncState('ok');
    backgroundSync();
  });
  window.addEventListener('offline', () => {
    state.online = false;
    setSyncState('error', 'Sin conexión');
  });
}

/* ================= ARRANQUE ================= */
async function bootstrap() {
  setSyncState('local', 'Cargando…');
  state.matches = readMatches();
  bindEvents();
  renderHistory();
  renderDash();
  switchTab(lsGet(LS.tab) || 'plantilla');
  await fetchPlayers(false);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}




