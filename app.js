/* Apartment Notes — a personal apartment-visit journal.
 * All data lives in this browser's IndexedDB. Use Settings → Export/Import to back up or move devices.
 */
(() => {
  'use strict';

  // ---------- Storage (IndexedDB) ----------
  const DB_NAME = 'apartment-notes';
  const DB_VERSION = 1;
  let dbPromise;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('apartments')) db.createObjectStore('apartments', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
    });
  }
  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const store = {
    all: () => tx('apartments', 'readonly', s => reqP(s.getAll())),
    get: id => tx('apartments', 'readonly', s => reqP(s.get(id))),
    put: apt => tx('apartments', 'readwrite', s => { s.put(apt); }),
    del: id => tx('apartments', 'readwrite', s => { s.delete(id); }),
    clear: () => tx('apartments', 'readwrite', s => { s.clear(); }),
    getSetting: k => tx('settings', 'readonly', s => reqP(s.get(k))),
    setSetting: (k, v) => tx('settings', 'readwrite', s => { s.put(v, k); }),
  };

  const DEFAULT_REQS = [
    'In-unit washer/dryer',
    'Parking',
    'Pet friendly',
    'Air conditioning',
    'Within budget',
  ];
  const STATUSES = ['Interested', 'Maybe', 'Applied', 'Pass'];
  const STATUS_CLASS = { Interested: 'good', Maybe: 'warn', Applied: '', Pass: 'bad' };

  async function getReqs() {
    const r = await store.getSetting('requirements');
    return Array.isArray(r) ? r : DEFAULT_REQS;
  }

  // ---------- Helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const app = $('#app');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
  const money = n => (n || n === 0) && n !== '' ? '$' + Number(n).toLocaleString() : '';
  const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const stars = n => `<span class="stars">${'★'.repeat(n || 0)}<span class="off">${'★'.repeat(5 - (n || 0))}</span></span>`;

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  function hostLabel(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'listing'; }
  }

  // Guess a name/address from listing URLs like zillow.com/apartments/el-cajon-ca/parkway-club/5XjR75/
  function guessFromUrl(url) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      // Title-case a slug; a trailing 2-letter word is treated as a state code (el-cajon-ca → El Cajon CA)
      const title = s => s.split('-').filter(Boolean).map((w, i, arr) =>
        (i === arr.length - 1 && i > 0 && /^[a-z]{2}$/.test(w)) || (i === arr.length - 2 && /^\d{5}$/.test(arr[i + 1]) && /^[a-z]{2}$/.test(w))
          ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)).join(' ');
      if (u.hostname.includes('zillow.com')) {
        if (parts[0] === 'apartments' && parts.length >= 3) {
          const city = title(parts[1]).replace(/ ([A-Z]{2})$/, ', $1');
          return { name: title(parts[2]), address: city };
        }
        if (parts[0] === 'homedetails' && parts[1]) {
          return { name: '', address: title(parts[1]).replace(/ ([A-Z]{2}) (\d{5})$/, ', $1 $2') };
        }
      }
      const slug = parts.find(p => /[a-z]-[a-z]/i.test(p) && !/^\d+$/.test(p));
      return slug ? { name: title(slug), address: '' } : {};
    } catch { return {}; }
  }

  // Resize photos client-side so storage stays small.
  function compressImage(file, maxDim = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not read image'));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function coverOf(apt) {
    const p = apt.photos?.find(p => p.id === apt.coverId) || apt.photos?.[0];
    if (p) return p.data;
    return apt.imageUrls?.map(safeUrl).find(Boolean) || '';
  }

  function reqScore(apt, reqs) {
    const vals = reqs.map(r => apt.reqs?.[r]);
    return { met: vals.filter(v => v === 'yes').length, missing: vals.filter(v => v === 'no').length, total: reqs.length };
  }

  function openLightbox(src) {
    $('#lightboxImg').src = src;
    $('#lightbox').showModal();
  }
  $('#lightbox').addEventListener('click', e => { if (e.target.id === 'lightbox') $('#lightbox').close(); });

  // ---------- Voice: transcription (on-device Whisper in a worker) ----------
  let worker = null;
  let jobSeq = 0;
  const jobs = new Map();
  let progressListener = null;

  function getWorker() {
    if (worker) return worker;
    worker = new Worker('transcribe-worker.js', { type: 'module' });
    const files = {};
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') {
        const p = data.data;
        if (p.status === 'progress' && p.total) {
          files[p.file] = { loaded: p.loaded, total: p.total };
          const all = Object.values(files);
          const loaded = all.reduce((s, f) => s + f.loaded, 0);
          const total = all.reduce((s, f) => s + f.total, 0);
          progressListener?.(`Downloading speech model (one-time) — ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB`);
        }
        return;
      }
      const job = jobs.get(data.id);
      if (!job) return;
      if (data.type === 'status') job.onStatus?.(data.status);
      if (data.type === 'done') { jobs.delete(data.id); job.resolve(data.text); }
      if (data.type === 'error') { jobs.delete(data.id); job.reject(new Error(data.message)); }
    };
    worker.onerror = e => {
      for (const j of jobs.values()) j.reject(new Error(e.message || 'Speech model failed to load'));
      jobs.clear(); worker = null;
    };
    return worker;
  }

  // Decode any audio the browser can play (webm, m4a, mp3, wav, voice memos…) into 16 kHz mono samples.
  async function decodeTo16k(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    let decoded;
    try { decoded = await ctx.decodeAudioData(await blob.arrayBuffer()); }
    finally { ctx.close?.(); }
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * 16000)), 16000);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    const rendered = await off.startRendering();
    return { samples: rendered.getChannelData(0), duration: decoded.duration };
  }

  function transcribe(samples, onStatus) {
    return new Promise((resolve, reject) => {
      const id = ++jobSeq;
      jobs.set(id, { resolve, reject, onStatus });
      getWorker().postMessage({ id, audio: samples }, [samples.buffer]);
    });
  }

  const blobToDataUrl = blob => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob);
  });

  // ---------- Voice: turn a transcript into form fields with Claude ----------
  const ANTHROPIC_SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
  let anthropicClient = null, anthropicClientKey = null;

  async function getAnthropic(apiKey) {
    if (anthropicClient && anthropicClientKey === apiKey) return anthropicClient;
    const { default: Anthropic } = await import(ANTHROPIC_SDK_URL);
    // The key is the user's own, typed into Settings and kept in this browser only.
    anthropicClient = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    anthropicClientKey = apiKey;
    return anthropicClient;
  }

  const EXTRACT_SYSTEM = `You fill in a personal apartment-hunting journal from a spoken recap. One or more people recorded their thoughts during or after touring an apartment; the transcript comes from automatic speech recognition, so expect small transcription errors and fix obvious ones (e.g. misheard numbers or place names) from context.

Rules:
- Use only what the speakers said. Use null for any field they did not mention, and empty arrays when nothing applies. Do not invent details.
- price is the monthly rent in US dollars as a plain number. If they mention several units, use the one they seem to be considering.
- visitDate: only if they say when they visited; resolve relative dates ("yesterday", "Saturday") against today's date, format YYYY-MM-DD.
- rating: 1-5. Use a rating they state; otherwise infer it only when their overall feeling is clear (loved it ≈ 5, liked it ≈ 4, mixed ≈ 3, disappointed ≈ 2, hated it ≈ 1); otherwise null.
- status: "Interested", "Maybe", "Applied", or "Pass" based on what they say they want to do; null if unclear.
- requirements: for each item in the requirement list that they talk about, answer "yes" if the place has it, "no" if it doesn't, "unsure" if it came up without a clear answer. Leave out requirements they never mention. Match by meaning, not exact wording (e.g. "there's a washer and dryer in the unit" → "In-unit washer/dryer": yes).
- likes / dislikes: short phrases (under 12 words) in plain language, one idea each.
- notes: other useful facts as short lines starting with "- " (fees, deposits, move-in specials, lease terms, neighborhood, commute, the leasing agent, questions to follow up on). Empty string if nothing else.`;

  function extractionSchema(reqs) {
    const nullable = t => ({ type: [t, 'null'] });
    return {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'address', 'price', 'beds', 'baths', 'sqft', 'visitDate', 'rating', 'status', 'requirements', 'likes', 'dislikes', 'notes'],
      properties: {
        name: nullable('string'),
        address: nullable('string'),
        price: nullable('number'),
        beds: nullable('number'),
        baths: nullable('number'),
        sqft: nullable('number'),
        visitDate: nullable('string'),
        rating: nullable('integer'),
        status: { anyOf: [{ type: 'string', enum: STATUSES }, { type: 'null' }] },
        requirements: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['requirement', 'answer'],
            properties: {
              requirement: reqs.length ? { type: 'string', enum: reqs } : { type: 'string' },
              answer: { type: 'string', enum: ['yes', 'no', 'unsure'] },
            },
          },
        },
        likes: { type: 'array', items: { type: 'string' } },
        dislikes: { type: 'array', items: { type: 'string' } },
        notes: { type: 'string' },
      },
    };
  }

  async function extractFromTranscript(transcript, reqs, apiKey) {
    const client = await getAnthropic(apiKey);
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: extractionSchema(reqs) } },
      system: EXTRACT_SYSTEM,
      messages: [{
        role: 'user',
        content: `Today's date: ${today}\n\nMy requirement list:\n${reqs.map(r => `- ${r}`).join('\n') || '(none)'}\n\n<transcript>\n${transcript}\n</transcript>`,
      }],
    });
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to process this transcript.');
    if (response.stop_reason === 'max_tokens') throw new Error('The response was cut off — try a shorter recording.');
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return JSON.parse(text);
  }

  function friendlyApiError(err) {
    const s = err?.status;
    if (s === 401) return 'Your Anthropic API key was rejected. Check it in Settings.';
    if (s === 429) return 'Rate limited by Anthropic — wait a moment and try again.';
    if (s === 400 && /credit|billing/i.test(err.message)) return 'Your Anthropic account is out of credits.';
    if (s >= 500 || s === 529) return 'Anthropic is busy right now — try again in a minute.';
    return err?.message || 'Something went wrong.';
  }

  // ---------- Router ----------
  const go = h => { location.hash = h; };
  window.addEventListener('hashchange', route);
  $('#homeLink').onclick = () => go('#/');
  $('#newBtn').onclick = () => go('#/new');

  let listState = { q: '', sort: 'updated', status: '' };

  async function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [a, b, c] = h.split('/');
    window.scrollTo(0, 0);
    if (a === 'new') return renderEdit(null);
    if (a === 'apt' && b && c === 'edit') return renderEdit(b);
    if (a === 'apt' && b) return renderView(b);
    return renderList();
  }

  // ---------- List ----------
  async function renderList() {
    const [apts, reqs] = await Promise.all([store.all(), getReqs()]);
    if (!apts.length) {
      app.innerHTML = `
        <div class="empty">
          <div class="big">🏡</div>
          <h1>No visits logged yet</h1>
          <p>After touring a place, jot down what you liked, what you didn't, and whether it checks your boxes.</p>
          <p><button class="btn primary" id="firstBtn">+ Log your first visit</button></p>
        </div>`;
      $('#firstBtn').onclick = () => go('#/new');
      return;
    }

    app.innerHTML = `
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search name, address, notes…" value="${esc(listState.q)}" />
        <select id="statusF">
          <option value="">All statuses</option>
          ${STATUSES.map(s => `<option ${listState.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select id="sort">
          ${[['updated', 'Recently updated'], ['rating', 'Highest rated'], ['reqs', 'Most requirements met'], ['price', 'Lowest price'], ['visit', 'Visit date']]
            .map(([v, l]) => `<option value="${v}" ${listState.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="grid" id="grid"></div>`;

    const draw = () => {
      const q = listState.q.toLowerCase();
      let list = apts.filter(a => {
        if (listState.status && a.status !== listState.status) return false;
        if (!q) return true;
        return [a.name, a.address, a.notes, ...(a.likes || []), ...(a.dislikes || [])].join(' ').toLowerCase().includes(q);
      });
      const sorters = {
        updated: (x, y) => (y.updatedAt || 0) - (x.updatedAt || 0),
        rating: (x, y) => (y.rating || 0) - (x.rating || 0),
        reqs: (x, y) => reqScore(y, reqs).met - reqScore(x, reqs).met || reqScore(x, reqs).missing - reqScore(y, reqs).missing,
        price: (x, y) => (Number(x.price) || Infinity) - (Number(y.price) || Infinity),
        visit: (x, y) => (y.visitDate || '').localeCompare(x.visitDate || ''),
      };
      list.sort(sorters[listState.sort]);
      $('#grid').innerHTML = list.length ? list.map(a => {
        const cover = coverOf(a);
        const sc = reqScore(a, reqs);
        return `
          <article class="card" data-id="${esc(a.id)}">
            <div class="card-img">${cover ? `<img src="${esc(cover)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith('🏢')" />` : '🏢'}</div>
            <div class="card-body">
              <div class="row"><div class="card-title">${esc(a.name || 'Untitled place')}</div><div class="spacer"></div>${stars(a.rating)}</div>
              <div class="card-sub">${esc(a.address || '')}${a.price ? ` · ${money(a.price)}/mo` : ''}</div>
              <div class="chips">
                ${a.status ? `<span class="chip ${STATUS_CLASS[a.status] ?? ''}">${esc(a.status)}</span>` : ''}
                ${sc.total ? `<span class="chip ${sc.missing ? 'bad' : sc.met === sc.total ? 'good' : 'warn'}">✓ ${sc.met}/${sc.total} reqs</span>` : ''}
                ${a.visitDate ? `<span class="chip">Visited ${esc(fmtDate(a.visitDate))}</span>` : ''}
              </div>
            </div>
          </article>`;
      }).join('') : `<p class="muted">No matches.</p>`;
      app.querySelectorAll('.card').forEach(c => c.onclick = () => go('#/apt/' + c.dataset.id));
    };
    draw();
    $('#q').oninput = e => { listState.q = e.target.value; draw(); };
    $('#statusF').onchange = e => { listState.status = e.target.value; draw(); };
    $('#sort').onchange = e => { listState.sort = e.target.value; draw(); };
  }

  // ---------- View ----------
  async function renderView(id) {
    const [a, reqs] = await Promise.all([store.get(id), getReqs()]);
    if (!a) { app.innerHTML = `<div class="empty"><h1>Not found</h1><p><a href="#/">Back to list</a></p></div>`; return; }
    const cover = coverOf(a);
    const sc = reqScore(a, reqs);
    const link = safeUrl(a.link);
    const listingImgs = (a.imageUrls || []).map(safeUrl).filter(Boolean);
    const extraReqs = Object.keys(a.reqs || {}).filter(r => !reqs.includes(r));

    app.innerHTML = `
      <p><a href="#/">← All visits</a></p>
      <div class="hero">${cover ? `<img src="${esc(cover)}" alt="" referrerpolicy="no-referrer" id="heroImg" onerror="this.replaceWith('🏢')" />` : '🏢'}</div>
      <div class="view-head">
        <div>
          <h1>${esc(a.name || 'Untitled place')}</h1>
          <div class="muted">${esc(a.address || '')}</div>
          <div class="row" style="margin-top:6px">${stars(a.rating)} ${a.status ? `<span class="chip ${STATUS_CLASS[a.status] ?? ''}">${esc(a.status)}</span>` : ''}</div>
        </div>
        <div class="row">
          <button class="btn" id="editBtn">✎ Edit</button>
          <button class="btn danger" id="delBtn">Delete</button>
        </div>
      </div>

      <div class="panel facts">
        ${a.price ? `<div>Rent <b>${money(a.price)}/mo</b></div>` : ''}
        ${a.beds ? `<div><b>${esc(a.beds)}</b> bd</div>` : ''}
        ${a.baths ? `<div><b>${esc(a.baths)}</b> ba</div>` : ''}
        ${a.sqft ? `<div><b>${Number(a.sqft).toLocaleString()}</b> sqft</div>` : ''}
        ${a.visitDate ? `<div>Visited <b>${esc(fmtDate(a.visitDate))}</b></div>` : ''}
        ${!a.price && !a.beds && !a.baths && !a.sqft && !a.visitDate ? '<div>No details added.</div>' : ''}
      </div>

      ${link ? `<div class="panel"><h2>Listing</h2><div class="link-box"><span>🔗</span><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(link)}</a></div>
        <div class="row" style="margin-top:8px"><a class="btn small" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open photos on ${esc(hostLabel(link))} ↗</a></div></div>` : ''}

      <div class="panel">
        <h2>Requirements <span class="req-summary muted">— ${sc.met}/${sc.total} met${sc.missing ? `, ${sc.missing} missing` : ''}</span></h2>
        ${reqs.length ? `<ul class="plain" style="list-style:none;padding:0">${reqs.map(r => {
          const v = a.reqs?.[r];
          const icon = v === 'yes' ? '<span class="chip good">✓ Yes</span>' : v === 'no' ? '<span class="chip bad">✕ No</span>' : '<span class="chip warn">? Unsure</span>';
          return `<li class="row" style="padding:4px 0">${icon}<span>${esc(r)}</span></li>`;
        }).join('')}</ul>` : '<p class="muted">No requirements set. Add some in Settings.</p>'}
        ${extraReqs.length ? `<p class="muted" style="margin-top:8px">Also recorded (no longer in your list): ${extraReqs.map(r => `${esc(r)} (${esc(a.reqs[r])})`).join(', ')}</p>` : ''}
      </div>

      <div class="two-col">
        <div class="panel"><h2>👍 Liked</h2>${a.likes?.length ? `<ul class="plain">${a.likes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Nothing noted.</p>'}</div>
        <div class="panel"><h2>👎 Disliked</h2>${a.dislikes?.length ? `<ul class="plain">${a.dislikes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="muted">Nothing noted.</p>'}</div>
      </div>

      ${a.notes ? `<div class="panel"><h2>Notes</h2><div class="notes">${esc(a.notes)}</div></div>` : ''}

      ${a.recordings?.length ? `<div class="panel"><h2>🎙 Recordings</h2>${a.recordings.map(r => `
        <div class="rec-item">
          <div class="muted">${esc(new Date(r.createdAt).toLocaleString())}${r.source ? ` · ${esc(r.source)}` : ''}</div>
          ${r.audio ? `<audio controls preload="none" src="${esc(r.audio)}"></audio>` : ''}
          ${r.transcript ? `<details><summary>Transcript</summary><p class="notes">${esc(r.transcript)}</p></details>` : ''}
        </div>`).join('')}</div>` : ''}

      ${(a.photos?.length || listingImgs.length) ? `<div class="panel"><h2>Photos</h2><div class="photos">
        ${(a.photos || []).map(p => `<div class="photo"><img src="${esc(p.data)}" alt="" loading="lazy" /></div>`).join('')}
        ${listingImgs.map(u => `<div class="photo"><img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()" /></div>`).join('')}
      </div></div>` : ''}
    `;
    $('#editBtn').onclick = () => go(`#/apt/${id}/edit`);
    $('#delBtn').onclick = async () => {
      if (!confirm(`Delete "${a.name || 'this place'}"? This can't be undone.`)) return;
      await store.del(id); toast('Deleted'); go('#/');
    };
    app.querySelectorAll('.photo img, #heroImg').forEach(img => img.onclick = () => openLightbox(img.src));
  }

  // ---------- Edit / New ----------
  async function renderEdit(id) {
    const reqs = await getReqs();
    const existing = id ? await store.get(id) : null;
    const a = existing ? structuredClone(existing) : {
      id: uid(), name: '', address: '', link: '', imageUrls: [], price: '', beds: '', baths: '', sqft: '',
      visitDate: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10), rating: 0, status: 'Interested',
      reqs: {}, likes: [], dislikes: [], notes: '', photos: [], coverId: null, createdAt: Date.now(),
    };
    a.recordings ||= [];
    let currentReqs = reqs;
    let dirty = false;

    app.innerHTML = `
      <p><a href="${existing ? `#/apt/${esc(a.id)}` : '#/'}">← Cancel</a></p>
      <h1>${existing ? 'Edit visit' : 'New visit'}</h1>

      <div class="panel voice-panel">
        <h2>🎙 Talk it through</h2>
        <p class="muted">Record your thoughts (or import a voice memo) and the form below gets filled in for you. You can record more than once — each one adds to the visit.</p>
        <div class="row">
          <button type="button" class="btn primary" id="recBtn">● Record</button>
          <label class="btn">⬆ Import audio<input type="file" id="audioIn" accept="audio/*,video/mp4,video/quicktime,.m4a,.mp3,.wav,.aac,.ogg,.webm" hidden /></label>
          <span class="rec-timer" id="recTimer" hidden></span>
        </div>
        <div class="voice-status" id="voiceStatus" hidden></div>
        <div id="transcriptBox" hidden>
          <div class="field full" style="margin-top:12px">
            <label for="transcript">Transcript (fix anything that was misheard, then fill)</label>
            <textarea id="transcript" rows="5"></textarea>
          </div>
          <div class="row" style="margin-top:8px">
            <button type="button" class="btn primary" id="fillBtn">✨ Fill in the form</button>
            <button type="button" class="btn" id="toNotesBtn">Add transcript to notes</button>
          </div>
        </div>
        <div id="recList"></div>
      </div>

      <div class="panel">
        <h2>Listing link</h2>
        <div class="field full">
          <label for="link">Zillow, Apartments.com, or any page with pictures</label>
          <input type="url" id="link" placeholder="https://www.zillow.com/apartments/…" value="${esc(a.link)}" />
        </div>
        <div class="field full" style="margin-top:10px">
          <label for="imageUrls">Listing image URLs (optional, one per line — right-click a photo on the listing → "Copy image address")</label>
          <textarea id="imageUrls" rows="2" placeholder="https://photos.zillowstatic.com/…">${esc((a.imageUrls || []).join('\n'))}</textarea>
        </div>
      </div>

      <div class="panel">
        <h2>The place</h2>
        <div class="fields">
          <div class="field full"><label for="name">Name</label><input type="text" id="name" placeholder="e.g. Parkway Club" value="${esc(a.name)}" /></div>
          <div class="field full"><label for="address">Address / area</label><input type="text" id="address" placeholder="Street, city" value="${esc(a.address)}" /></div>
          <div class="field"><label for="price">Rent ($/mo)</label><input type="number" id="price" min="0" inputmode="numeric" value="${esc(a.price)}" /></div>
          <div class="field"><label for="beds">Beds</label><input type="number" id="beds" min="0" step="0.5" value="${esc(a.beds)}" /></div>
          <div class="field"><label for="baths">Baths</label><input type="number" id="baths" min="0" step="0.5" value="${esc(a.baths)}" /></div>
          <div class="field"><label for="sqft">Sq ft</label><input type="number" id="sqft" min="0" value="${esc(a.sqft)}" /></div>
          <div class="field"><label for="visitDate">Visit date</label><input type="date" id="visitDate" value="${esc(a.visitDate)}" /></div>
        </div>
      </div>

      <div class="panel">
        <h2>My verdict</h2>
        <div class="fields">
          <div class="field"><label>Overall rating</label><div class="star-input" id="starInput"></div></div>
          <div class="field"><label>Status</label><div class="status-pills" id="statusPills"></div></div>
        </div>
      </div>

      <div class="panel">
        <h2>Requirements</h2>
        <p class="muted">Does it have what you need? <a href="#" id="editReqsLink">Edit my requirements list</a></p>
        <div class="req-list" id="reqList"></div>
      </div>

      <div class="two-col">
        <div class="panel list-editor likes"><h2>👍 What I liked</h2><ul id="likesList"></ul>
          <div class="add-row"><input type="text" id="likeIn" placeholder="e.g. Lots of natural light" /><button class="btn" id="likeAdd">Add</button></div></div>
        <div class="panel list-editor dislikes"><h2>👎 What I disliked</h2><ul id="dislikesList"></ul>
          <div class="add-row"><input type="text" id="dislikeIn" placeholder="e.g. Street noise" /><button class="btn" id="dislikeAdd">Add</button></div></div>
      </div>

      <div class="panel">
        <h2>Notes</h2>
        <textarea id="notes" rows="5" placeholder="Neighborhood vibe, leasing agent, move-in specials, questions to follow up on…">${esc(a.notes)}</textarea>
      </div>

      <div class="panel">
        <h2>My photos <span class="muted">(optional)</span></h2>
        <label class="drop" id="drop">📷 Tap to add photos, or drop them here
          <input type="file" id="photoIn" accept="image/*" multiple hidden />
        </label>
        <div class="photos" id="photoGrid"></div>
      </div>

      <div class="sticky-save">
        <a class="btn ghost" href="${existing ? `#/apt/${esc(a.id)}` : '#/'}">Cancel</a>
        <button class="btn primary" id="saveBtn">Save visit</button>
      </div>
    `;

    const markDirty = () => { dirty = true; };
    app.querySelectorAll('input, textarea').forEach(el => el.addEventListener('input', markDirty));

    // Auto-fill name/address from link
    $('#link').addEventListener('change', e => {
      const g = guessFromUrl(e.target.value.trim());
      if (g.name && !$('#name').value) $('#name').value = g.name;
      if (g.address && !$('#address').value) $('#address').value = g.address;
    });

    // Stars
    const drawStars = () => {
      $('#starInput').innerHTML = [1, 2, 3, 4, 5].map(n => `<button type="button" data-n="${n}" class="${n <= a.rating ? 'on' : ''}" aria-label="${n} star">★</button>`).join('');
      $('#starInput').querySelectorAll('button').forEach(b => b.onclick = () => { const n = +b.dataset.n; a.rating = a.rating === n ? 0 : n; dirty = true; drawStars(); });
    };
    drawStars();

    // Status
    const drawStatus = () => {
      $('#statusPills').innerHTML = STATUSES.map(s => `<button type="button" class="btn small ${a.status === s ? 'on' : ''}">${s}</button>`).join('');
      $('#statusPills').querySelectorAll('button').forEach(b => b.onclick = () => { a.status = b.textContent; dirty = true; drawStatus(); });
    };
    drawStatus();

    // Requirements
    const drawReqs = list => {
      $('#reqList').innerHTML = list.length ? list.map((r, i) => {
        const v = a.reqs[r];
        return `<div class="req-item"><span class="req-name">${esc(r)}</span>
          <div class="tri" data-i="${i}">
            <button type="button" class="yes ${v === 'yes' ? 'on' : ''}" data-v="yes">✓ Yes</button>
            <button type="button" class="no ${v === 'no' ? 'on' : ''}" data-v="no">✕ No</button>
            <button type="button" class="na ${v === 'unsure' ? 'on' : ''}" data-v="unsure">?</button>
          </div></div>`;
      }).join('') : '<p class="muted">No requirements yet — add some via the link above.</p>';
      $('#reqList').querySelectorAll('.tri button').forEach(b => b.onclick = () => {
        const r = list[+b.parentElement.dataset.i];
        a.reqs[r] = a.reqs[r] === b.dataset.v ? undefined : b.dataset.v;
        if (!a.reqs[r]) delete a.reqs[r];
        dirty = true; drawReqs(list);
      });
    };
    drawReqs(reqs);
    $('#editReqsLink').onclick = e => { e.preventDefault(); openSettings(newReqs => { currentReqs = newReqs; drawReqs(newReqs); }); };

    // Likes / dislikes
    const listEditor = (key, ulId, inId, btnId) => {
      const draw = () => {
        $(ulId).innerHTML = a[key].map((x, i) => `<li><span>${esc(x)}</span><button type="button" data-i="${i}" aria-label="Remove">✕</button></li>`).join('');
        $(ulId).querySelectorAll('button').forEach(b => b.onclick = () => { a[key].splice(+b.dataset.i, 1); dirty = true; draw(); });
      };
      const add = () => {
        const v = $(inId).value.trim();
        if (!v) return;
        a[key].push(v); $(inId).value = ''; dirty = true; draw(); $(inId).focus();
      };
      $(btnId).onclick = add;
      $(inId).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      draw();
      return draw;
    };
    const drawLikes = listEditor('likes', '#likesList', '#likeIn', '#likeAdd');
    const drawDislikes = listEditor('dislikes', '#dislikesList', '#dislikeIn', '#dislikeAdd');

    // ----- Voice: record / import → transcribe → fill -----
    const status = (html, kind = '') => {
      const el = $('#voiceStatus');
      if (!html) { el.hidden = true; return; }
      el.hidden = false; el.className = `voice-status ${kind}`; el.innerHTML = html;
    };
    let busy = false;
    let lastRecordingId = null;

    const drawRecordings = () => {
      $('#recList').innerHTML = a.recordings.length ? `<h3 class="rec-heading">Recordings</h3>` + a.recordings.map(r => `
        <div class="rec-item" data-id="${esc(r.id)}">
          <div class="row">
            <span class="muted">${esc(new Date(r.createdAt).toLocaleString())}${r.source ? ` · ${esc(r.source)}` : ''}</span>
            <div class="spacer"></div>
            <button type="button" class="btn small ghost rec-del">Remove</button>
          </div>
          ${r.audio ? `<audio controls preload="none" src="${esc(r.audio)}"></audio>` : ''}
          ${r.transcript ? `<details><summary>Transcript</summary><p class="notes">${esc(r.transcript)}</p></details>` : ''}
        </div>`).join('') : '';
      $('#recList').querySelectorAll('.rec-del').forEach(b => b.onclick = () => {
        const id = b.closest('.rec-item').dataset.id;
        if (!confirm('Remove this recording? (Anything already filled in stays.)')) return;
        a.recordings = a.recordings.filter(r => r.id !== id); dirty = true; drawRecordings();
      });
    };
    drawRecordings();

    const flash = el => { el.classList.remove('filled'); void el.offsetWidth; el.classList.add('filled'); };

    const applyExtraction = x => {
      let n = 0;
      const setInput = (id, val, onlyIfEmpty = false) => {
        if (val === null || val === undefined || val === '') return;
        const el = $('#' + id);
        if (onlyIfEmpty && el.value.trim()) return;
        if (String(el.value) === String(val)) return;
        el.value = val; flash(el); n++;
      };
      setInput('name', x.name, true);
      setInput('address', x.address, true);
      setInput('price', x.price);
      setInput('beds', x.beds);
      setInput('baths', x.baths);
      setInput('sqft', x.sqft);
      if (x.visitDate && /^\d{4}-\d{2}-\d{2}$/.test(x.visitDate)) setInput('visitDate', x.visitDate);
      if (Number.isInteger(x.rating) && x.rating !== a.rating) { a.rating = Math.min(5, Math.max(1, x.rating)); drawStars(); flash($('#starInput')); n++; }
      if (x.status && STATUSES.includes(x.status) && x.status !== a.status) { a.status = x.status; drawStatus(); flash($('#statusPills')); n++; }
      for (const { requirement, answer } of x.requirements || []) {
        if (!currentReqs.includes(requirement)) continue;
        if (answer === 'unsure' && a.reqs[requirement]) continue;
        if (a.reqs[requirement] !== answer) { a.reqs[requirement] = answer; n++; }
      }
      drawReqs(currentReqs);
      const addUnique = (key, items) => {
        const seen = new Set(a[key].map(s => s.toLowerCase()));
        for (const it of items || []) {
          const v = String(it).trim();
          if (v && !seen.has(v.toLowerCase())) { a[key].push(v); seen.add(v.toLowerCase()); n++; }
        }
      };
      addUnique('likes', x.likes); addUnique('dislikes', x.dislikes);
      drawLikes(); drawDislikes();
      const extra = (x.notes || '').trim();
      if (extra && !$('#notes').value.includes(extra)) {
        $('#notes').value = ($('#notes').value.trim() ? $('#notes').value.trim() + '\n\n' : '') + extra;
        flash($('#notes')); n++;
      }
      dirty = true;
      return n;
    };

    const fill = async () => {
      const transcript = $('#transcript').value.trim();
      if (!transcript) { toast('Nothing to fill from yet'); return; }
      const key = await store.getSetting('anthropicKey');
      if (!key) {
        status(`Transcript ready. To auto-fill the form, add your Anthropic API key in <a href="#" id="openKey">Settings</a> — or tap “Add transcript to notes”.`, 'warn');
        $('#openKey').onclick = e => { e.preventDefault(); openSettings(newReqs => { currentReqs = newReqs; drawReqs(newReqs); }); };
        return;
      }
      busy = true; $('#fillBtn').disabled = true;
      status('<span class="spinner"></span> Reading your notes and filling in the form…');
      try {
        const x = await extractFromTranscript(transcript, currentReqs, key);
        const n = applyExtraction(x);
        status(n ? `✓ Filled in ${n} item${n === 1 ? '' : 's'} — they're highlighted below. Review, then save.` : 'Nothing new to fill in from that recording.', 'ok');
      } catch (err) {
        console.error(err);
        status(esc(friendlyApiError(err)) + ' Your transcript is kept above.', 'err');
      } finally { busy = false; $('#fillBtn').disabled = false; }
    };

    const processAudio = async (blob, source) => {
      if (busy) return;
      busy = true;
      $('#transcriptBox').hidden = true;
      try {
        status('<span class="spinner"></span> Preparing audio…');
        const { samples, duration } = await decodeTo16k(blob);
        if (duration < 1) throw new Error('That recording is too short.');
        const rec = { id: uid(), createdAt: Date.now(), source, transcript: '' };
        // Keep the audio with the visit unless it's very large.
        if (blob.size < 15e6) rec.audio = await blobToDataUrl(blob);
        a.recordings.push(rec); lastRecordingId = rec.id; dirty = true; drawRecordings();

        const mins = Math.max(1, Math.round(duration / 60));
        progressListener = msg => status(`<span class="spinner"></span> ${esc(msg)}`);
        status('<span class="spinner"></span> Loading speech model…');
        const text = await transcribe(samples, st => {
          if (st === 'transcribing') status(`<span class="spinner"></span> Transcribing ${mins > 1 ? `${mins} minutes of` : ''} audio… this can take a little while.`);
        });
        progressListener = null;
        if (!text) throw new Error("Couldn't make out any speech in that audio.");
        rec.transcript = text; drawRecordings();
        $('#transcript').value = text;
        $('#transcriptBox').hidden = false;
        busy = false;
        await fill();
      } catch (err) {
        console.error(err);
        status(esc(err?.message?.includes('decode') ? "That file couldn't be read as audio. Try an .m4a, .mp3 or .wav file." : (err.message || 'Transcription failed.')), 'err');
      } finally { busy = false; progressListener = null; }
    };

    $('#fillBtn').onclick = () => {
      // If the transcript was edited, keep the edited version with the recording.
      const r = a.recordings.find(r => r.id === lastRecordingId);
      if (r) { r.transcript = $('#transcript').value.trim(); drawRecordings(); }
      fill();
    };
    $('#toNotesBtn').onclick = () => {
      const t = $('#transcript').value.trim();
      if (!t) return;
      $('#notes').value = ($('#notes').value.trim() ? $('#notes').value.trim() + '\n\n' : '') + t;
      flash($('#notes')); dirty = true; toast('Added to notes');
    };
    $('#audioIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) processAudio(f, f.name); };

    // Recording
    let mediaRec = null, recStart = 0, recTick = null;
    const stopTracks = () => mediaRec?.stream.getTracks().forEach(t => t.stop());
    $('#recBtn').onclick = async () => {
      if (mediaRec && mediaRec.state === 'recording') { mediaRec.stop(); return; }
      if (busy) return;
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("This browser can't record audio. Try importing a voice memo instead."); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { status('Microphone access was blocked. Allow it in your browser settings, or import a voice memo instead.', 'err'); return; }
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find(m => MediaRecorder.isTypeSupported?.(m));
      mediaRec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      mediaRec.ondataavailable = e => e.data.size && chunks.push(e.data);
      mediaRec.onstop = () => {
        clearInterval(recTick); stopTracks();
        $('#recTimer').hidden = true;
        $('#recBtn').textContent = '● Record'; $('#recBtn').classList.remove('recording');
        const blob = new Blob(chunks, { type: mediaRec.mimeType || 'audio/webm' });
        mediaRec = null;
        processAudio(blob, 'Recorded');
      };
      mediaRec.start(1000);
      recStart = Date.now();
      $('#recBtn').textContent = '■ Stop'; $('#recBtn').classList.add('recording');
      $('#recTimer').hidden = false;
      const tick = () => { const s = Math.floor((Date.now() - recStart) / 1000); $('#recTimer').textContent = `🔴 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
      tick(); recTick = setInterval(tick, 500);
      status('Recording… talk about what you liked, what you didn\'t, the price, and whether it has what you need. Tap Stop when done.');
      // Make sure the mic is released if the user leaves the page mid-recording.
      const onLeave = () => { if (mediaRec) { mediaRec.onstop = null; mediaRec.stop(); stopTracks(); clearInterval(recTick); } window.removeEventListener('hashchange', onLeave); };
      window.addEventListener('hashchange', onLeave);
    };

    // Photos
    const drawPhotos = () => {
      $('#photoGrid').innerHTML = a.photos.map(p => `
        <div class="photo" data-id="${p.id}">
          <img src="${p.data}" alt="" />
          <button type="button" class="x" aria-label="Remove photo">✕</button>
          <button type="button" class="cover ${(a.coverId || a.photos[0]?.id) === p.id ? 'on' : ''}">${(a.coverId || a.photos[0]?.id) === p.id ? '★ Cover' : 'Set cover'}</button>
        </div>`).join('');
      $('#photoGrid').querySelectorAll('.photo').forEach(el => {
        const pid = el.dataset.id;
        el.querySelector('img').onclick = () => openLightbox(el.querySelector('img').src);
        el.querySelector('.x').onclick = () => { a.photos = a.photos.filter(p => p.id !== pid); if (a.coverId === pid) a.coverId = null; dirty = true; drawPhotos(); };
        el.querySelector('.cover').onclick = () => { a.coverId = pid; dirty = true; drawPhotos(); };
      });
    };
    const addFiles = async files => {
      const imgs = [...files].filter(f => f.type.startsWith('image/'));
      if (!imgs.length) return;
      toast(`Adding ${imgs.length} photo${imgs.length > 1 ? 's' : ''}…`);
      for (const f of imgs) {
        try { a.photos.push({ id: uid(), data: await compressImage(f) }); }
        catch { toast(`Couldn't read ${f.name}`); }
      }
      dirty = true; drawPhotos();
    };
    $('#photoIn').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
    const drop = $('#drop');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => addFiles(e.dataTransfer.files));
    drawPhotos();

    // Save
    $('#saveBtn').onclick = async () => {
      a.link = $('#link').value.trim();
      a.imageUrls = $('#imageUrls').value.split(/\s+/).map(s => s.trim()).filter(safeUrl);
      a.name = $('#name').value.trim();
      a.address = $('#address').value.trim();
      a.price = $('#price').value;
      a.beds = $('#beds').value;
      a.baths = $('#baths').value;
      a.sqft = $('#sqft').value;
      a.visitDate = $('#visitDate').value;
      a.notes = $('#notes').value;
      // Pick up text typed into like/dislike boxes but not yet added
      if ($('#likeIn').value.trim()) a.likes.push($('#likeIn').value.trim());
      if ($('#dislikeIn').value.trim()) a.dislikes.push($('#dislikeIn').value.trim());
      if (!a.name && a.link) a.name = guessFromUrl(a.link).name || hostLabel(a.link);
      if (!a.name && !a.address && !a.link) { toast('Add at least a name, address, or link'); $('#name').focus(); return; }
      a.updatedAt = Date.now();
      try {
        await store.put(a);
        dirty = false;
        toast('Saved ✓');
        go('#/apt/' + a.id);
      } catch (err) {
        console.error(err);
        toast('Save failed — storage may be full. Try removing some photos.');
      }
    };

    window.onbeforeunload = () => dirty ? true : undefined;
    const leave = () => { window.onbeforeunload = null; window.removeEventListener('hashchange', leave); };
    window.addEventListener('hashchange', leave);
  }

  // ---------- Settings ----------
  const dlg = $('#settingsDialog');
  let settingsCb = null;
  async function openSettings(cb) {
    settingsCb = cb || null;
    $('#reqText').value = (await getReqs()).join('\n');
    $('#apiKey').value = (await store.getSetting('anthropicKey')) || '';
    dlg.showModal();
  }
  $('#settingsBtn').onclick = () => openSettings();
  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'save') return;
    const list = [...new Set($('#reqText').value.split('\n').map(s => s.trim()).filter(Boolean))];
    await store.setSetting('requirements', list);
    await store.setSetting('anthropicKey', $('#apiKey').value.trim());
    toast('Settings saved');
    if (settingsCb) settingsCb(list); else route();
  });

  $('#exportBtn').onclick = async () => {
    const data = { app: 'apartment-notes', version: 1, exportedAt: new Date().toISOString(), requirements: await getReqs(), apartments: await store.all() };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = `apartment-notes-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(el); el.click(); el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  $('#importInput').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data.apartments)) throw new Error('bad file');
      const mode = confirm(`Import ${data.apartments.length} apartment(s)?\n\nOK = merge with what's here (same entries get updated)\nCancel = abort`);
      if (!mode) return;
      for (const apt of data.apartments) if (apt && apt.id) await store.put(apt);
      if (Array.isArray(data.requirements)) {
        const merged = [...new Set([...(await getReqs()), ...data.requirements])];
        await store.setSetting('requirements', merged);
        $('#reqText').value = merged.join('\n');
      }
      toast('Import complete');
      dlg.close();
      route();
    } catch {
      toast("That file doesn't look like an Apartment Notes backup");
    }
  };

  // Ask the browser to keep our data (helps on iOS/Safari eviction)
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

  route();
})();
