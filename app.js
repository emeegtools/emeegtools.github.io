/* EMEEG Online - Kumpra List + End of the Sales (view only).
   The data comes from Aronium on the store PC, sent here by the EMEEG Sync app. */
(function () {
  'use strict';
  const CFG = window.EMEEG_CONFIG || {};
  const BASE = String(CFG.supabaseUrl || '').trim().replace(/\/+$/, '');
  const KEY = CFG.supabaseKey || '';
  const TOKEN_KEY = 'emeeg_online_token';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const peso = (n) => '₱' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = (n) => (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const niceDate = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
  const monthName = (m) => new Date(m + '-01T12:00:00').toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (_) { /* private mode */ } } };

  const ICON = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    eos: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    kumpra: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M17 4a4 4 0 010 8M22 21c0-3-2-5-4-5.5"/>',
    me: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>'
  };
  const svg = (k) => `<svg class="i" viewBox="0 0 24 24">${ICON[k]}</svg>`;

  // ---------------------------------------------------------------- talking to Supabase
  let token = store.get(TOKEN_KEY);
  let me = null;      // { account, store }

  async function rpc(fn, args) {
    if (!BASE || !KEY) throw new Error('This website is not connected to Supabase yet (config.js).');
    let res;
    try {
      res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {})
      });
    } catch (_) {
      throw new Error('No internet connection. Try again.');
    }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    if (!res.ok) {
      const msg = (body && (body.message || body.error)) || res.statusText;
      if (/LOGIN_EXPIRED/.test(msg)) { logout(true); throw new Error('Please log in again.'); }
      if (res.status === 404 || /Could not find the function/.test(msg)) throw new Error('Supabase is not set up yet. Run the setup code from EMEEG Sync.');
      throw new Error(msg);
    }
    return body;
  }
  const call = (fn, args) => rpc(fn, { p_token: token, ...(args || {}) });

  // ---------------------------------------------------------------- small UI helpers
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (bad ? ' bad' : '');
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 2500);
  }
  async function attempt(fn, el) {
    if (el) el.classList.add('loading');
    try { return await fn(); } catch (e) { toast(e.message, true); return undefined; } finally { if (el) el.classList.remove('loading'); }
  }
  function ago(iso) {
    if (!iso) return 'never';
    const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000));
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' hr ago';
    return new Date(iso).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  const late = (iso) => !iso || Date.now() - new Date(iso) > 15 * 60 * 1000;

  // Print: fill the hidden print area, set the page size, print, clean up
  function printHtml(html, kind) {
    const area = $('#print');
    area.innerHTML = `<div class="${kind === 'thermal' ? 'pth' : 'pa4'}">${html}</div>`;
    let st = $('#pageStyle');
    if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
    st.textContent = kind === 'thermal'
      ? '@media print{@page{size:80mm auto;margin:0}.pth{width:72mm;padding:2mm 3mm}}'
      : '@media print{@page{size:A4;margin:12mm}}';
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); area.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 50);
  }

  // ---------------------------------------------------------------- login / logout
  function showLogin() {
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#cfgWarn').hidden = !!(BASE && KEY);
    setTimeout(() => $('#lUser').focus(), 50);
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#lBtn'), err = $('#lErr');
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Logging in…';
    try {
      const r = await rpc('eo_login', { p_username: $('#lUser').value, p_password: $('#lPass').value });
      if (!r || r.error || !r.token) throw new Error((r && r.error) || 'Could not log in');
      token = r.token;
      store.set(TOKEN_KEY, token);
      $('#lPass').value = '';
      await start();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Log in';
    }
  });
  function logout(silent) {
    if (token && !silent) rpc('eo_logout', { p_token: token }).catch(() => {});
    token = null;
    me = null;
    store.set(TOKEN_KEY, null);
    stopTimers();
    if (!silent) history.replaceState(null, '', location.pathname + location.search);
    showLogin();
  }

  // ---------------------------------------------------------------- shell + routing
  const can = (k) => me && me.account && me.account[k];
  function routes() {
    const r = [{ id: 'home', label: 'Home', icon: 'home' }];
    if (can('can_eos')) r.push({ id: 'eos', label: 'End of Sales', icon: 'eos' });
    if (can('can_kumpra')) r.push({ id: 'kumpra', label: 'Kumpra', icon: 'kumpra' });
    if (me.account.role === 'admin') r.push({ id: 'accounts', label: 'Accounts', icon: 'users' });
    r.push({ id: 'me', label: 'Me', icon: 'me' });
    return r;
  }
  function drawShell() {
    $('#storeName').textContent = (me.store && me.store.name) || CFG.storeName || 'EMEEG';
    const links = routes().map((r) => `<a href="#${r.id}" data-r="${r.id}">${svg(r.icon)}<span>${esc(r.label)}</span></a>`).join('');
    $('#tabs').innerHTML = links;
    $('#bottom').innerHTML = links;
    drawSyncInfo();
  }
  function drawSyncInfo() {
    const ls = me && me.store && me.store.last_sync;
    const el = $('#syncInfo');
    el.textContent = 'Store data: ' + ago(ls);
    el.className = 'sync-info' + (late(ls) ? ' late' : '');
    el.title = late(ls) ? 'EMEEG Sync on the store PC has not sent anything for a while. Is the store PC on and connected?' : '';
  }

  let timers = [];
  function stopTimers() { timers.forEach(clearInterval); timers = []; }
  function every(ms, fn) { timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms)); }

  const pages = {};
  let current = null;
  function go() {
    const id = (location.hash || '#home').slice(1).split('/')[0];
    const allowed = routes().map((r) => r.id);
    const page = allowed.includes(id) ? id : 'home';
    $$('[data-r]').forEach((a) => a.classList.toggle('active', a.dataset.r === page));
    stopTimers();
    every(60000, refreshMe);
    current = page;
    window.scrollTo(0, 0);
    pages[page]($('#main'));
  }
  window.addEventListener('hashchange', () => { if (me) go(); });

  async function refreshMe() {
    try { me = await call('eo_me'); drawSyncInfo(); } catch (_) { /* shown elsewhere */ }
  }

  async function start() {
    if (!token) return showLogin();
    try {
      me = await call('eo_me');
    } catch (e) {
      if (!token) return;               // logged out by an expired login
      $('#login').hidden = true;
      $('#app').hidden = false;
      $('#main').innerHTML = `<div class="card"><div class="err">${esc(e.message)}</div><p><button class="btn" onclick="location.reload()">Try again</button></p></div>`;
      return;
    }
    $('#login').hidden = true;
    $('#app').hidden = false;
    drawShell();
    go();
  }

  // ---------------------------------------------------------------- Home
  pages.home = async (main) => {
    const a = me.account;
    main.innerHTML = `
      <div class="head"><div><h1>Hi, ${esc(a.full_name || a.username)}</h1><div class="sub">${esc(niceDate(today()))}</div></div></div>
      <div id="hWarn"></div>
      <div class="grid kpis" id="hKpis"><div class="card empty">Loading…</div></div>`;
    const ls = me.store.last_sync;
    if (late(ls)) {
      $('#hWarn').innerHTML = `<div class="warn" style="margin-bottom:14px">The store PC last sent data ${esc(ago(ls))}. Sales shown here may not be complete. Check that the store PC is on, has internet, and EMEEG Sync is running.</div>`;
    }
    const cards = [];
    if (can('can_eos')) {
      const d = await attempt(() => call('eo_eos_day', { p_day: today() }));
      const data = d && d.data;
      cards.push(`<a class="card kpi" href="#eos" style="text-decoration:none;color:inherit"><div class="l">Sales today</div><div class="v">${peso(data ? data.totalSales : 0)}</div>
        <div class="s">${data ? data.users.map((u) => esc(u.name) + ' ' + peso(u.total)).join(' · ') : 'No sales yet today'}</div></a>`);
      cards.push(`<div class="card kpi"><div class="l">Cash Out today</div><div class="v">${peso(data ? data.totalCashOut : 0)}</div><div class="s">${data ? data.cashOuts.length : 0} entries</div></div>`);
    }
    if (can('can_kumpra')) {
      const list = await attempt(() => call('eo_kumpra_list')) || [];
      const left = list.filter((i) => !i.bought).length;
      cards.push(`<a class="card kpi" href="#kumpra" style="text-decoration:none;color:inherit"><div class="l">Kumpra list</div><div class="v">${left} to buy</div><div class="s">${list.length - left} already bought</div></a>`);
    }
    cards.push(`<div class="card kpi"><div class="l">Store data</div><div class="v" style="font-size:20px">${esc(ago(ls))}</div><div class="s">Sent by EMEEG Sync on the store PC</div></div>`);
    if (current === 'home') $('#hKpis').innerHTML = cards.join('');
  };

  // ---------------------------------------------------------------- End of the Sales (view only)
  const eos = { mode: 'day', day: null, month: null, data: null };
  pages.eos = (main) => {
    if (!eos.day) eos.day = today();
    if (!eos.month) eos.month = today().slice(0, 7);
    const sub = location.hash.split('/')[1];
    if (sub && /^\d{4}-\d{2}-\d{2}$/.test(sub)) { eos.mode = 'day'; eos.day = sub; }
    main.innerHTML = `
      <div class="head">
        <div><h1>End of the Sales</h1><div class="sub">From Aronium, each user's sales by category (view only)</div></div>
        <div class="seg" id="eMode"><button data-m="day">Day</button><button data-m="month">Month</button></div>
      </div>
      <div id="eBar" class="row" style="margin-bottom:14px"></div>
      <div id="eBody"></div>`;
    $$('#eMode button').forEach((b) => { b.onclick = () => { eos.mode = b.dataset.m; drawEos(); }; });
    drawEos();
    every(60000, () => { if (eos.mode === 'day' && eos.day === today()) loadDay(true); });
  };

  function drawEos() {
    $$('#eMode button').forEach((b) => b.classList.toggle('on', b.dataset.m === eos.mode));
    const bar = $('#eBar');
    if (eos.mode === 'day') {
      bar.innerHTML = `<div class="datebar">
          <button class="btn icon" id="ePrev" aria-label="Day before">‹</button>
          <input class="input" type="date" id="eDate" value="${esc(eos.day)}" max="${today()}">
          <button class="btn icon" id="eNext" aria-label="Next day">›</button>
          <button class="btn" id="eToday">Today</button>
        </div>
        <div class="actions" style="margin-left:auto"><button class="btn" id="eA4">Print A4</button><button class="btn" id="eTh">Print thermal</button></div>`;
      $('#eDate').onchange = (e) => { if (e.target.value) { eos.day = e.target.value; loadDay(); } };
      $('#ePrev').onclick = () => { eos.day = addDays(eos.day, -1); $('#eDate').value = eos.day; loadDay(); };
      $('#eNext').onclick = () => { if (eos.day >= today()) return; eos.day = addDays(eos.day, 1); $('#eDate').value = eos.day; loadDay(); };
      $('#eToday').onclick = () => { eos.day = today(); $('#eDate').value = eos.day; loadDay(); };
      $('#eA4').onclick = () => printDay('a4');
      $('#eTh').onclick = () => printDay('thermal');
      loadDay();
    } else {
      bar.innerHTML = `<div class="datebar">
          <button class="btn icon" id="mPrev" aria-label="Month before">‹</button>
          <input class="input" type="month" id="mMonth" value="${esc(eos.month)}">
          <button class="btn icon" id="mNext" aria-label="Next month">›</button>
        </div>
        <div class="actions" style="margin-left:auto"><button class="btn" id="mA4">Print A4</button></div>`;
      const shift = (n) => { const d = new Date(eos.month + '-15T12:00:00'); d.setMonth(d.getMonth() + n); eos.month = ymd(d).slice(0, 7); $('#mMonth').value = eos.month; loadMonth(); };
      $('#mMonth').onchange = (e) => { if (e.target.value) { eos.month = e.target.value; loadMonth(); } };
      $('#mPrev').onclick = () => shift(-1);
      $('#mNext').onclick = () => shift(1);
      $('#mA4').onclick = () => printMonth();
      loadMonth();
    }
  }

  async function loadDay(quiet) {
    const body = $('#eBody');
    if (!body) return;
    if (!quiet) body.innerHTML = '<div class="card empty">Loading…</div>';
    const r = await attempt(() => call('eo_eos_day', { p_day: eos.day }));
    if (!r || current !== 'eos' || eos.mode !== 'day') return;
    eos.data = r;
    if (r.last_sync) { me.store.last_sync = r.last_sync; drawSyncInfo(); }
    const d = r.data;
    if (!d) {
      body.innerHTML = `<div class="card empty"><b>No sales for ${esc(niceDate(eos.day))}.</b><br>
        ${eos.day === today() ? 'Sales show here about a minute after they are saved in Aronium.' : 'Either the store was closed, or this day is older than what EMEEG Sync keeps up to date.'}
        ${r.prev ? `<p><button class="btn" id="eGoPrev">Go to ${esc(niceDate(r.prev))}</button></p>` : ''}</div>`;
      const gp = $('#eGoPrev');
      if (gp) gp.onclick = () => { eos.day = r.prev; $('#eDate').value = eos.day; loadDay(); };
      return;
    }
    const cats = d.categories || [];
    const usedCats = cats.filter((c) => Number(d.byCategory[c]) !== 0 || d.users.some((u) => u.categories[c]));
    body.innerHTML = `
      <div class="grid kpis">
        <div class="card kpi"><div class="l">Total sales</div><div class="v">${peso(d.totalSales)}</div><div class="s">${d.users.length} user(s)</div></div>
        <div class="card kpi"><div class="l">Cash Out</div><div class="v">${peso(d.totalCashOut)}</div><div class="s">${d.cashOuts.length} entries</div></div>
        <div class="card kpi"><div class="l">Sales − Cash Out</div><div class="v ${d.net < 0 ? 'neg' : ''}">${peso(d.net)}</div><div class="s">Updated ${esc(ago(r.updated_at))}</div></div>
      </div>
      <h2 style="margin:20px 0 10px;font-size:17px">Each user</h2>
      <div class="grid users">
        ${d.users.map((u) => `<div class="card"><h2>${esc(u.name)}</h2>
          <table class="t"><tbody>
            ${cats.filter((c) => u.categories[c]).map((c) => `<tr><td>${esc(c)}</td><td class="n ${u.categories[c] < 0 ? 'neg' : ''}">${num(u.categories[c])}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No sales</td></tr>'}
            <tr class="total"><td>Total</td><td class="n">${num(u.total)}</td></tr>
          </tbody></table></div>`).join('') || '<div class="card empty">No sales by any user</div>'}
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-top:14px">
        <div class="card"><h2>All users by category</h2>
          <table class="t"><thead><tr><th>Category</th>${d.users.map((u) => `<th class="n">${esc(u.name.split(' ')[0])}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
            ${usedCats.map((c) => `<tr><td>${esc(c)}</td>${d.users.map((u) => `<td class="n">${u.categories[c] ? num(u.categories[c]) : '–'}</td>`).join('')}<td class="n"><b>${num(d.byCategory[c])}</b></td></tr>`).join('')}
            <tr class="total"><td>Total</td>${d.users.map((u) => `<td class="n">${num(u.total)}</td>`).join('')}<td class="n">${num(d.totalSales)}</td></tr>
          </tbody></table></div>
        <div class="card"><h2>Cash Out (from Aronium)</h2>
          ${d.cashOuts.length ? `<table class="t"><tbody>
            ${d.cashOuts.map((c) => `<tr><td class="muted" style="width:52px">${esc(c.time)}</td><td>${esc(c.description || '(no description)')}</td><td class="n">${num(c.amount)}</td></tr>`).join('')}
            <tr class="total"><td></td><td>Total</td><td class="n">${num(d.totalCashOut)}</td></tr></tbody></table>` : '<div class="empty">No Cash Out this day</div>'}
        </div>
      </div>
      <p class="small muted mt">Expenses typed by hand, the cash count and remarks stay in EMEEG Tools at the store.</p>`;
  }

  function printDay(kind) {
    const r = eos.data;
    if (!r || !r.data) return toast('No report to print for this day', true);
    const d = r.data, cats = d.categories, name = (me.store && me.store.name) || 'EMEEG';
    if (kind === 'thermal') {
      const lr = (a, b, bold) => `<div class="lr${bold ? ' b' : ''}"><span>${esc(a)}</span><span>${esc(b)}</span></div>`;
      printHtml(`<div class="c b">${esc(name)}</div><div class="c b">END OF THE SALES</div><div class="c">${esc(niceDate(eos.day))}</div><hr>
        ${d.users.map((u) => `<div class="b">${esc(u.name)}</div>${cats.filter((c) => u.categories[c]).map((c) => lr(c, num(u.categories[c]))).join('')}${lr('TOTAL', num(u.total), true)}<hr>`).join('')}
        <div class="b">ALL USERS</div>${cats.filter((c) => d.byCategory[c]).map((c) => lr(c, num(d.byCategory[c]))).join('')}${lr('TOTAL SALES', num(d.totalSales), true)}<hr>
        ${d.cashOuts.length ? `<div class="b">CASH OUT</div>${d.cashOuts.map((c) => lr(c.description || '-', num(c.amount))).join('')}${lr('TOTAL CASH OUT', num(d.totalCashOut), true)}<hr>` : ''}
        ${lr('SALES - CASH OUT', num(d.net), true)}<hr><div class="c">Printed ${esc(new Date().toLocaleString('en-PH'))}</div>`, 'thermal');
    } else {
      printHtml(`<h1>${esc(name)} — End of the Sales</h1><div class="sub">${esc(niceDate(eos.day))} · from Aronium</div>
        <h2>Sales by category</h2>
        <table><thead><tr><th>Category</th>${d.users.map((u) => `<th class="n">${esc(u.name)}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
        ${cats.map((c) => `<tr><td>${esc(c)}</td>${d.users.map((u) => `<td class="n">${u.categories[c] ? num(u.categories[c]) : ''}</td>`).join('')}<td class="n">${num(d.byCategory[c])}</td></tr>`).join('')}
        <tr class="total"><td>Total</td>${d.users.map((u) => `<td class="n">${num(u.total)}</td>`).join('')}<td class="n">${num(d.totalSales)}</td></tr></tbody></table>
        <h2>Cash Out</h2>
        ${d.cashOuts.length ? `<table><tbody>${d.cashOuts.map((c) => `<tr><td style="width:15mm">${esc(c.time)}</td><td>${esc(c.description)}</td><td class="n">${num(c.amount)}</td></tr>`).join('')}
        <tr class="total"><td></td><td>Total Cash Out</td><td class="n">${num(d.totalCashOut)}</td></tr></tbody></table>` : '<p>None</p>'}
        <h2>Summary</h2>
        <table><tbody><tr><td>Total sales</td><td class="n">${num(d.totalSales)}</td></tr><tr><td>Total Cash Out</td><td class="n">${num(d.totalCashOut)}</td></tr>
        <tr class="total"><td>Sales − Cash Out</td><td class="n">${num(d.net)}</td></tr></tbody></table>`, 'a4');
    }
  }

  async function loadMonth() {
    const body = $('#eBody');
    body.innerHTML = '<div class="card empty">Loading…</div>';
    const rows = await attempt(() => call('eo_eos_month', { p_month: eos.month }));
    if (!rows || current !== 'eos' || eos.mode !== 'month') return;
    eos.monthRows = rows;
    if (!rows.length) { body.innerHTML = `<div class="card empty">No sales online for ${esc(monthName(eos.month))}.</div>`; return; }
    const tS = rows.reduce((a, r) => a + Number(r.total_sales), 0), tC = rows.reduce((a, r) => a + Number(r.total_cash_out), 0);
    const catTotals = {};
    for (const c of (me.store && me.store.categories) || []) catTotals[c] = 0;
    for (const r of rows) for (const [c, v] of Object.entries(r.byCategory || {})) catTotals[c] = (catTotals[c] || 0) + Number(v);
    body.innerHTML = `
      <div class="grid kpis">
        <div class="card kpi"><div class="l">Sales in ${esc(monthName(eos.month))}</div><div class="v">${peso(tS)}</div><div class="s">${rows.length} day(s) with sales</div></div>
        <div class="card kpi"><div class="l">Cash Out</div><div class="v">${peso(tC)}</div></div>
        <div class="card kpi"><div class="l">Sales − Cash Out</div><div class="v">${peso(tS - tC)}</div><div class="s">Average sales/day ${peso(tS / rows.length)}</div></div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-top:14px">
        <div class="card"><h2>Each day <span class="small muted">(tap a day to open it)</span></h2>
          <table class="t"><thead><tr><th>Day</th><th class="n">Sales</th><th class="n">Cash Out</th><th class="n">Net</th></tr></thead><tbody>
          ${rows.map((r) => `<tr class="click" data-day="${esc(r.day)}"><td>${esc(new Date(r.day + 'T12:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }))}</td>
            <td class="n">${num(r.total_sales)}</td><td class="n">${num(r.total_cash_out)}</td><td class="n">${num(r.total_sales - r.total_cash_out)}</td></tr>`).join('')}
          <tr class="total"><td>Total</td><td class="n">${num(tS)}</td><td class="n">${num(tC)}</td><td class="n">${num(tS - tC)}</td></tr></tbody></table></div>
        <div class="card"><h2>By category</h2>
          <table class="t"><tbody>${Object.entries(catTotals).filter(([, v]) => v).map(([c, v]) => `<tr><td>${esc(c)}</td><td class="n">${num(v)}</td></tr>`).join('')}
          <tr class="total"><td>Total</td><td class="n">${num(tS)}</td></tr></tbody></table></div>
      </div>`;
    $$('tr[data-day]', body).forEach((tr) => { tr.onclick = () => { eos.mode = 'day'; eos.day = tr.dataset.day; drawEos(); }; });
  }

  function printMonth() {
    const rows = eos.monthRows;
    if (!rows || !rows.length) return toast('No sales to print for this month', true);
    const tS = rows.reduce((a, r) => a + Number(r.total_sales), 0), tC = rows.reduce((a, r) => a + Number(r.total_cash_out), 0);
    printHtml(`<h1>${esc((me.store && me.store.name) || 'EMEEG')} — Sales for ${esc(monthName(eos.month))}</h1><div class="sub">From Aronium</div>
      <table><thead><tr><th>Day</th><th class="n">Sales</th><th class="n">Cash Out</th><th class="n">Sales − Cash Out</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(niceDate(r.day))}</td><td class="n">${num(r.total_sales)}</td><td class="n">${num(r.total_cash_out)}</td><td class="n">${num(r.total_sales - r.total_cash_out)}</td></tr>`).join('')}
      <tr class="total"><td>Total</td><td class="n">${num(tS)}</td><td class="n">${num(tC)}</td><td class="n">${num(tS - tC)}</td></tr></tbody></table>`, 'a4');
  }

  // ---------------------------------------------------------------- Kumpra List
  const kum = { items: [], products: null, cats: [] };
  pages.kumpra = (main) => {
    kum.cats = [...((me.store && me.store.categories) || [])];
    if (!kum.cats.includes('Others')) kum.cats.push('Others');
    main.innerHTML = `
      <div class="head">
        <div><h1>Kumpra List</h1><div class="sub">Type items in any order — the printout sorts them by category</div></div>
        <div class="actions"><button class="btn" id="kA4">Print A4</button><button class="btn dark" id="kTh">Print thermal</button></div>
      </div>
      <div class="card">
        <form class="kform" id="kForm" autocomplete="off">
          <label class="field">Listahanan (item)<input class="input" id="kName" list="kProducts" placeholder="Start typing — picks from Aronium products" enterkeyhint="done"></label>
          <datalist id="kProducts"></datalist>
          <label class="field">Category<select class="input" id="kCat">${kum.cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
          <button class="btn primary" type="submit" style="min-height:44px">Add</button>
        </form>
        <div id="kList"><div class="empty">Loading…</div></div>
        <div class="actions mt" id="kActs"></div>
      </div>`;
    const name = $('#kName'), cat = $('#kCat');
    name.addEventListener('input', () => {
      const v = name.value.trim().toLowerCase();
      const p = (kum.products || []).find((x) => x[0].toLowerCase() === v);
      if (p && kum.cats.includes(p[1])) cat.value = p[1];
    });
    $('#kForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return name.focus();
      const items = await attempt(() => call('eo_kumpra_add', { p_name: name.value, p_category: cat.value }), $('#kForm'));
      if (items) { name.value = ''; name.focus(); drawKumpra(items); }
    });
    $('#kA4').onclick = () => printKumpra('a4');
    $('#kTh').onclick = () => printKumpra('thermal');
    loadKumpra();
    every(20000, loadKumpra);
    if (!kum.products) {
      attempt(() => call('eo_products')).then((p) => {
        kum.products = p || [];
        const dl = $('#kProducts');
        if (dl) dl.innerHTML = kum.products.map((x) => `<option value="${esc(x[0])}"></option>`).join('');
      });
    } else {
      $('#kProducts').innerHTML = kum.products.map((x) => `<option value="${esc(x[0])}"></option>`).join('');
    }
  };

  async function loadKumpra() {
    const items = await attempt(() => call('eo_kumpra_list'));
    if (items && current === 'kumpra') drawKumpra(items);
  }
  function grouped(items) {
    const order = [...kum.cats];
    for (const i of items) if (!order.includes(i.category)) order.push(i.category);
    return order.map((c) => ({ cat: c, items: items.filter((i) => i.category === c) })).filter((g) => g.items.length);
  }
  function drawKumpra(items) {
    kum.items = items;
    const list = $('#kList');
    if (!list) return;
    const groups = grouped(items);
    list.innerHTML = groups.length ? groups.map((g) => `
      <div class="kgroup"><h3><span>${esc(g.cat)}</span><span class="muted">${g.items.filter((i) => !i.bought).length}</span></h3>
        ${g.items.map((i) => `<div class="kitem${i.bought ? ' bought' : ''}">
          <label><input type="checkbox" data-id="${i.id}" ${i.bought ? 'checked' : ''}><span><span class="nm">${esc(i.name)}</span><br><span class="by">${esc(i.added_by || '')}</span></span></label>
          <button class="xbtn" data-del="${i.id}" aria-label="Remove ${esc(i.name)}">✕</button></div>`).join('')}
      </div>`).join('') : '<div class="empty">The list is empty. Type an item above.</div>';
    $$('input[data-id]', list).forEach((c) => { c.onchange = async () => { const r = await attempt(() => call('eo_kumpra_set', { p_id: Number(c.dataset.id), p_bought: c.checked })); if (r) drawKumpra(r); }; });
    $$('[data-del]', list).forEach((b) => { b.onclick = async () => { const r = await attempt(() => call('eo_kumpra_remove', { p_id: Number(b.dataset.del) })); if (r) drawKumpra(r); }; });
    const bought = items.filter((i) => i.bought).length;
    $('#kActs').innerHTML = items.length ? `
      ${bought ? `<button class="btn" id="kClrB">Remove ${bought} bought item(s)</button>` : ''}
      <button class="btn danger" id="kClr">Clear whole list</button>` : '';
    const cb = $('#kClrB'), ca = $('#kClr');
    if (cb) cb.onclick = async () => { const r = await attempt(() => call('eo_kumpra_clear', { p_only_bought: true })); if (r) drawKumpra(r); };
    if (ca) ca.onclick = async () => { if (!confirm('Clear the WHOLE Kumpra list?')) return; const r = await attempt(() => call('eo_kumpra_clear', { p_only_bought: false })); if (r) drawKumpra(r); };
  }
  function printKumpra(kind) {
    const items = kum.items.filter((i) => !i.bought);
    if (!items.length) return toast('Nothing to buy on the list', true);
    const groups = grouped(items), name = (me.store && me.store.name) || 'EMEEG';
    if (kind === 'thermal') {
      printHtml(`<div class="c b">${esc(name)}</div><div class="c b">KUMPRA LIST</div><div class="c">${esc(niceDate(today()))}</div><hr>
        ${groups.map((g) => `<div class="b" style="margin-top:1.5mm">[${esc(g.cat)}]</div>${g.items.map((i) => `<div>[ ] ${esc(i.name)}</div>`).join('')}`).join('')}<hr>
        <div class="c">${items.length} item(s)</div>`, 'thermal');
    } else {
      printHtml(`<h1>${esc(name)} — Kumpra List</h1><div class="sub">${esc(niceDate(today()))} · ${items.length} item(s)</div><div class="cols">
        ${groups.map((g) => `<div class="grp"><h2>${esc(g.cat)}</h2>${g.items.map((i) => `<div class="ki"><span class="box"></span>${esc(i.name)}</div>`).join('')}</div>`).join('')}</div>`, 'a4');
    }
  }

  // ---------------------------------------------------------------- Accounts (admin)
  let accounts = [];
  pages.accounts = async (main) => {
    main.innerHTML = `
      <div class="head"><div><h1>Accounts</h1><div class="sub">Who can log in, and what they can see</div></div>
        <button class="btn primary" id="aNew">+ New account</button></div>
      <div class="card" id="aList"><div class="empty">Loading…</div></div>
      <p class="small muted">Staff can always add to the Kumpra List if “Kumpra List” is ticked. Only tick “End of the Sales” for people who may see the sales.</p>`;
    $('#aNew').onclick = () => editAccount(null);
    const r = await attempt(() => call('eo_accounts_list'));
    if (r) drawAccounts(r);
  };
  function drawAccounts(list) {
    accounts = list;
    const el = $('#aList');
    if (!el) return;
    el.innerHTML = `<table class="t"><thead><tr><th>Name</th><th>Username</th><th>Can use</th><th></th></tr></thead><tbody>
      ${list.map((a) => `<tr>
        <td><b>${esc(a.full_name || '—')}</b>${a.id === me.account.id ? ' <span class="small muted">(you)</span>' : ''}</td>
        <td>${esc(a.username)}</td>
        <td>${a.role === 'admin' ? '<span class="chip admin">Admin · everything</span>' : [a.can_kumpra ? '<span class="chip ok">Kumpra</span>' : '', a.can_eos ? '<span class="chip ok">End of Sales</span>' : ''].join(' ') || '<span class="chip">nothing</span>'}
          ${a.active ? '' : ' <span class="chip off">turned off</span>'}</td>
        <td class="n"><button class="btn" data-edit="${a.id}">Edit</button></td></tr>`).join('')}</tbody></table>`;
    $$('[data-edit]', el).forEach((b) => { b.onclick = () => editAccount(accounts.find((a) => a.id === Number(b.dataset.edit))); });
  }
  function editAccount(a) {
    const isNew = !a;
    a = a || { username: '', full_name: '', role: 'staff', raw_can_kumpra: true, raw_can_eos: false, active: true };
    const dlg = $('#dlg');
    dlg.innerHTML = `<form method="dialog" id="accForm">
      <h2>${isNew ? 'New account' : 'Edit ' + esc(a.username)}</h2>
      <label class="field">Full name<input class="input" name="full_name" value="${esc(a.full_name)}" placeholder="e.g. Gail"></label>
      <label class="field">Username<input class="input" name="username" value="${esc(a.username)}" autocapitalize="none" required></label>
      <label class="field">${isNew ? 'Password (6+ characters)' : 'New password (leave empty to keep)'}<input class="input" name="password" type="text" autocomplete="off" ${isNew ? 'required minlength="6"' : ''}></label>
      <label class="field">Role<select class="input" name="role"><option value="staff">Staff</option><option value="admin">Admin (everything, incl. accounts)</option></select></label>
      <div id="perm">
        <label class="check"><input type="checkbox" name="can_kumpra" ${a.raw_can_kumpra ? 'checked' : ''}> Kumpra List</label>
        <label class="check mt"><input type="checkbox" name="can_eos" ${a.raw_can_eos ? 'checked' : ''}> End of the Sales (sees the sales)</label>
      </div>
      <label class="check"><input type="checkbox" name="active" ${a.active ? 'checked' : ''}> Can log in</label>
      <div class="err" id="accErr" hidden></div>
      <div class="row" style="justify-content:space-between">
        ${isNew || a.id === me.account.id ? '<span></span>' : '<button class="btn danger" type="button" id="accDel">Delete</button>'}
        <div class="row"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" type="submit" id="accSave">Save</button></div>
      </div></form>`;
    const f = $('#accForm');
    f.role.value = a.role;
    const perm = () => { $('#perm').style.opacity = f.role.value === 'admin' ? 0.4 : 1; };
    f.role.onchange = perm; perm();
    $('#accSave').onclick = async (e) => {
      e.preventDefault();
      if (!f.reportValidity()) return;
      const p = { id: isNew ? null : a.id, username: f.username.value.trim(), full_name: f.full_name.value.trim(), password: f.password.value,
        role: f.role.value, can_kumpra: f.can_kumpra.checked, can_eos: f.can_eos.checked, active: f.active.checked };
      try { drawAccounts(await call('eo_account_save', { p })); dlg.close(); toast('Saved'); } catch (ex) { $('#accErr').textContent = ex.message; $('#accErr').hidden = false; }
    };
    const del = $('#accDel');
    if (del) del.onclick = async () => {
      if (!confirm(`Delete the account “${a.username}”? This cannot be undone.`)) return;
      try { drawAccounts(await call('eo_account_delete', { p_id: a.id })); dlg.close(); toast('Deleted'); } catch (ex) { $('#accErr').textContent = ex.message; $('#accErr').hidden = false; }
    };
    dlg.showModal();
  }

  // ---------------------------------------------------------------- Me
  pages.me = (main) => {
    const a = me.account;
    main.innerHTML = `
      <div class="head"><div><h1>${esc(a.full_name || a.username)}</h1><div class="sub">Logged in as ${esc(a.username)} · ${a.role === 'admin' ? 'Admin' : 'Staff'}</div></div>
        <button class="btn danger" id="mOut">Log out</button></div>
      <div class="card" style="max-width:460px">
        <h2>Change my password</h2>
        <form id="pwForm" class="grid">
          <label class="field">Current password<input class="input" type="password" name="old" autocomplete="current-password" required></label>
          <label class="field">New password (6+ characters)<input class="input" type="password" name="n1" autocomplete="new-password" minlength="6" required></label>
          <label class="field">Type it again<input class="input" type="password" name="n2" autocomplete="new-password" required></label>
          <button class="btn primary" type="submit">Change password</button>
        </form>
      </div>
      <p class="small muted mt">Install on your phone: Android — menu ⋮ › <b>Install app</b> / <b>Add to Home screen</b>. iPhone — Share › <b>Add to Home Screen</b>.</p>`;
    $('#mOut').onclick = () => logout();
    $('#pwForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.n1.value !== f.n2.value) return toast('The two new passwords are not the same', true);
      const ok = await attempt(() => call('eo_change_password', { p_old: f.old.value, p_new: f.n1.value }), f);
      if (ok !== undefined) { f.reset(); toast('Password changed'); }
    };
  };

  // ---------------------------------------------------------------- start
  document.addEventListener('visibilitychange', () => { if (!document.hidden && me) { refreshMe(); if (current === 'kumpra') loadKumpra(); } });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  start();
})();
