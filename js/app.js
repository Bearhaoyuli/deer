import { GitHub, textToB64, fileToB64 } from './github.js';

const TOKEN_KEY = 'fanarchive.token';
const DATA_PATH = 'data/memories.json';
const MAX_BYTES = 45 * 1024 * 1024; // GitHub hard limit is 100MB; base64 in-browser gets heavy past this

const S = {
  cfg: null,
  items: [],
  gh: null,
  login: null,
  blobs: {},          // repo path -> objectURL for files uploaded this session (Pages redeploy lag)
  drafts: [],
  editing: null,      // moment being edited, or {type:'quote', _new:true}
  filter: { type: 'all', tag: null },
  visible: [],        // ordered list currently shown (for lightbox prev/next)
  lbIndex: -1,
};

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d || 1); };
const fmtDay = (s) => parseDay(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtMonth = (ym) => parseDay(ym + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(-60) || 'file';
const kindOf = (file) => (file.type.match(/^(image|video|audio)\//) || [])[1] || null;
const parseTags = (s) => [...new Set(String(s || '').split(/[,，#]/).map((t) => t.trim().toLowerCase()).filter(Boolean))];
const isMedia = (m) => ['image', 'video', 'audio'].includes(m.type);

let toastTimer;
function toast(text, { error = false, ms = 3200 } = {}) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.toggle('error', error);
  el.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function rawUrl(path) {
  const { owner, repo, branch } = S.cfg.github;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
const mediaUrl = (src) => (/^(https?:|data:|blob:)/.test(src) ? src : S.blobs[src] || src);
const rawAttr = (src) => (src && !/^https?:/.test(src) ? `data-raw="${esc(rawUrl(src))}"` : '');

/* ---------------- data ---------------- */
async function loadItems() {
  let data;
  if (S.gh) data = JSON.parse((await S.gh.readText(DATA_PATH)).text);
  else data = await (await fetch(DATA_PATH, { cache: 'no-store' })).json();
  S.items = data.moments || [];
}

/** Read latest JSON from the repo, apply mutator, commit. Retries once on sha conflict. */
async function commitItems(mutate, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { sha, text } = await S.gh.readText(DATA_PATH);
    const data = JSON.parse(text);
    data.moments = mutate(data.moments || []).sort((a, b) => a.date.localeCompare(b.date));
    try {
      await S.gh.putFile(DATA_PATH, textToB64(JSON.stringify(data, null, 2) + '\n'), message, sha);
      S.items = data.moments;
      render();
      return;
    } catch (e) {
      if (attempt === 0 && (e.status === 409 || e.status === 422)) continue;
      throw e;
    }
  }
}

/* ---------------- rendering ---------------- */
const TYPES = [
  ['all', 'All'], ['image', 'Photos'], ['video', 'Clips'], ['audio', 'Audio'], ['quote', 'Quotes'],
];

function matches(m) {
  const { type, tag } = S.filter;
  return (type === 'all' || m.type === type) && (!tag || (m.tags || []).includes(tag));
}

function cardHTML(m) {
  const tags = (m.tags || []).length ? `<div class="tags">${m.tags.map((t) => `<span>#${esc(t)}</span>`).join('')}</div>` : '';
  const meta = `<div class="meta">${m.featured ? '<span class="star">★ Featured</span>' : ''}<span>${fmtDay(m.date)}</span>${m.by ? `<span>· by ${esc(m.by)}</span>` : ''}</div>`;
  const edit = S.gh ? `<button type="button" class="edit-btn" data-edit>Edit</button>` : '';
  const cls = `card ${m.type === 'quote' ? 'quote' : ''} ${m.featured ? 'featured' : ''}`;

  if (m.type === 'quote') {
    return `<article class="${cls}" data-id="${esc(m.id)}">${edit}<div class="body">
      ${m.title ? `<h3>${esc(m.title)}</h3>` : ''}<blockquote>${esc(m.text)}</blockquote>${meta}${tags}</div></article>`;
  }
  let media = '';
  const src = esc(mediaUrl(m.src || ''));
  if (m.type === 'image') media = `<button type="button" class="media" data-open><img src="${src}" ${rawAttr(m.src)} alt="${esc(m.title || '')}" loading="lazy"></button>`;
  if (m.type === 'video') media = `<button type="button" class="media" data-open><video src="${src}#t=0.1" ${rawAttr(m.src)} muted playsinline preload="metadata"></video><span class="play">▶</span></button>`;
  const audio = m.type === 'audio' ? `<audio src="${src}" ${rawAttr(m.src)} controls preload="none"></audio>` : '';
  return `<article class="${cls}" data-id="${esc(m.id)}">${edit}${media}<div class="body">
    ${meta}${m.title ? `<h3>${esc(m.title)}</h3>` : ''}${m.text ? `<p>${esc(m.text)}</p>` : ''}${audio}${tags}</div></article>`;
}

function render() {
  const all = [...S.items].sort((a, b) => a.date.localeCompare(b.date));
  const shown = all.filter(matches);
  S.visible = shown.filter((m) => m.type === 'image' || m.type === 'video');

  // stats
  $('#statMoments').textContent = all.length;
  $('#statMedia').textContent = all.filter(isMedia).length;
  $('#statFans').textContent = new Set(all.map((m) => m.by).filter(Boolean)).size;

  // collage: featured images first, then latest images
  const imgs = all.filter((m) => m.type === 'image');
  const pick = [...imgs.filter((m) => m.featured), ...imgs.reverse()].filter((m, i, a) => a.indexOf(m) === i).slice(0, 3);
  $('#collage').innerHTML = pick.map((m) =>
    `<button type="button" class="pol" data-id="${esc(m.id)}"><img src="${esc(mediaUrl(m.src))}" ${rawAttr(m.src)} alt=""><span>${esc(m.title || fmtDay(m.date))}</span></button>`).join('');

  // filters
  $('#typeChips').innerHTML = TYPES
    .filter(([t]) => t === 'all' || all.some((m) => m.type === t))
    .map(([t, label]) => `<button type="button" class="chip" data-type="${t}" aria-pressed="${S.filter.type === t}">${label}</button>`).join('');
  const tagCounts = {};
  all.forEach((m) => (m.tags || []).forEach((t) => (tagCounts[t] = (tagCounts[t] || 0) + 1)));
  $('#tagChips').innerHTML = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])
    .map(([t]) => `<button type="button" class="chip" data-tag="${esc(t)}" aria-pressed="${S.filter.tag === t}">#${esc(t)}</button>`).join('');

  // chapters by month
  const months = {};
  for (const m of shown) (months[m.date.slice(0, 7)] ||= []).push(m);
  const keys = Object.keys(months).sort();
  $('#chapters').innerHTML = keys.length ? keys.map((ym, i) => `
    <section class="chapter" id="ch-${ym}">
      <div class="chapter-head">
        <span class="num">${String(i + 1).padStart(2, '0')}</span>
        <h2>${esc(S.cfg.chapters?.[ym] || fmtMonth(ym))}<small>${fmtMonth(ym)}</small></h2>
        <span class="count">${months[ym].length} moment${months[ym].length === 1 ? '' : 's'}</span>
      </div>
      <div class="grid">${months[ym].map(cardHTML).join('')}</div>
    </section>`).join('')
    : `<p class="empty">Nothing here yet${S.gh ? ' — drag photos or clips onto the page to add some.' : '.'}</p>`;
}

/* ---------------- lightbox ---------------- */
function openLightbox(id) {
  const i = S.visible.findIndex((m) => m.id === id);
  if (i < 0) return;
  S.lbIndex = i;
  showLightbox();
  if (!$('#lightbox').open) $('#lightbox').showModal();
}
function showLightbox() {
  const m = S.visible[S.lbIndex];
  const src = esc(mediaUrl(m.src));
  $('#lbMedia').innerHTML = m.type === 'video'
    ? `<video src="${src}" ${rawAttr(m.src)} controls autoplay playsinline></video>`
    : `<img src="${src}" ${rawAttr(m.src)} alt="${esc(m.title || '')}">`;
  $('#lbCap').innerHTML = `<h3>${esc(m.title || '')}</h3><p>${fmtDay(m.date)}${m.text ? ' · ' + esc(m.text) : ''}</p>`;
  $$('.lb-nav').forEach((b) => (b.hidden = S.visible.length < 2));
}
function stepLightbox(d) {
  if (!S.visible.length) return;
  S.lbIndex = (S.lbIndex + d + S.visible.length) % S.visible.length;
  showLightbox();
}

/* ---------------- auth ---------------- */
async function login(token, { silent = false } = {}) {
  const gh = new GitHub(token, S.cfg.github);
  const info = await gh.repoInfo();
  if (!info.permissions?.push) throw new Error('This token can read but not write. Give it "Contents: Read and write".');
  let name = 'editor';
  try { name = (await gh.user()).login; } catch {}
  S.gh = gh;
  S.login = name;
  store.set(TOKEN_KEY, token);
  document.body.classList.add('editing');
  $('#loginBtn').textContent = `@${name} · Log out`;
  if (!silent) toast(`Logged in as @${name}. Drag photos or clips anywhere to add moments.`, { ms: 5000 });
}

function logout() {
  S.gh = null;
  S.login = null;
  store.del(TOKEN_KEY);
  document.body.classList.remove('editing');
  $('#loginBtn').textContent = 'Fan login';
  render();
  toast('Logged out.');
}

/* ---------------- uploads ---------------- */
function openDrafts(files) {
  if (!S.gh) { $('#loginDlg').showModal(); return; }
  const ok = [];
  for (const f of files) {
    const kind = kindOf(f);
    if (!kind) { toast(`Skipped ${f.name}: only images, video and audio.`, { error: true }); continue; }
    if (f.size > MAX_BYTES) { toast(`Skipped ${f.name}: over 45MB. Trim or compress it first.`, { error: true, ms: 6000 }); continue; }
    if (/heic|heif/i.test(f.type || f.name)) toast(`${f.name}: HEIC may not show in browsers. Export as JPG if it looks broken.`, { error: true, ms: 6000 });
    ok.push({
      id: uid(), file: f, kind, url: URL.createObjectURL(f),
      date: isoDay(new Date(f.lastModified || Date.now())),
      title: f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80),
      text: '', tags: '', by: S.login || '', featured: false,
    });
  }
  if (!ok.length) return;
  S.drafts.push(...ok);
  renderDrafts();
  if (!$('#uploadDlg').open) $('#uploadDlg').showModal();
}

function renderDrafts() {
  $('#uploadCount').textContent = S.drafts.length;
  $('#drafts').innerHTML = S.drafts.map((d) => `
    <div class="draft" data-id="${d.id}">
      ${d.kind === 'image' ? `<img class="thumb" src="${d.url}" alt="">`
        : d.kind === 'video' ? `<video class="thumb" src="${d.url}#t=0.1" muted preload="metadata"></video>` : `<div class="thumb">🎵</div>`}
      <div class="fields">
        <input name="title" type="text" placeholder="Title" value="${esc(d.title)}" maxlength="120">
        <input name="date" type="date" value="${d.date}" required>
        <input name="text" class="full" type="text" placeholder="What happened? (optional)" value="${esc(d.text)}" maxlength="2000">
        <input name="tags" type="text" placeholder="tags: funny, music" value="${esc(d.tags)}">
        <input name="by" type="text" placeholder="Your fan name" value="${esc(d.by)}" maxlength="40">
        <label class="full"><input name="featured" type="checkbox"${d.featured ? ' checked' : ''}> Featured</label>
      </div>
      <button type="button" class="rm" title="Remove">✕</button>
    </div>`).join('');
}

async function publishDrafts() {
  const drafts = S.drafts.splice(0);
  $('#uploadDlg').close();
  const added = [];
  try {
    for (const [i, d] of drafts.entries()) {
      toast(`Uploading ${i + 1}/${drafts.length}: ${d.file.name}…`, { ms: 0 });
      const path = `media/${d.date.slice(0, 7)}/${uid()}-${slug(d.file.name)}`;
      await S.gh.putFile(path, await fileToB64(d.file), `Add moment: ${d.title || d.file.name}`);
      S.blobs[path] = d.url;
      added.push(clean({
        id: uid(), date: d.date, type: d.kind, src: path, title: d.title.trim(), text: d.text.trim(),
        tags: parseTags(d.tags), by: d.by.trim(), featured: d.featured,
      }));
    }
  } catch (e) {
    toast(`Upload failed: ${e.message}`, { error: true, ms: 8000 });
  }
  if (!added.length) return;
  try {
    toast('Saving…', { ms: 0 });
    await commitItems((list) => [...list, ...added], `Add ${added.length} moment${added.length === 1 ? '' : 's'}`);
    document.getElementById(`ch-${added[0].date.slice(0, 7)}`)?.scrollIntoView();
    toast(`Added ${added.length}. Public site refreshes in ~1 min.`, { ms: 5000 });
  } catch (e) {
    toast(`Save failed: ${e.message}`, { error: true, ms: 8000 });
  }
}

/** drop empty fields so the JSON stays tidy */
function clean(m) {
  for (const k of Object.keys(m)) if (m[k] === '' || m[k] === false || m[k] == null || (Array.isArray(m[k]) && !m[k].length)) delete m[k];
  return m;
}

/* ---------------- edit / new quote ---------------- */
function openEdit(m) {
  S.editing = m;
  $('#editTitle').textContent = m._new ? 'New quote' : 'Edit moment';
  $('#eDelete').hidden = !!m._new;
  $('#eTitle').value = m.title || '';
  $('#eDate').value = (m.date || isoDay(new Date())).slice(0, 10);
  $('#eTextLabel').textContent = m.type === 'quote' ? 'Quote' : 'Description';
  $('#eText').value = m.text || '';
  $('#eText').required = m.type === 'quote';
  $('#eTags').value = (m.tags || []).join(', ');
  $('#eBy').value = m.by || S.login || '';
  $('#eFeatured').checked = !!m.featured;
  $('#editDlg').showModal();
}

async function saveEdit() {
  const m = S.editing;
  const fields = {
    title: $('#eTitle').value.trim(), date: $('#eDate').value, text: $('#eText').value.trim(),
    tags: parseTags($('#eTags').value), by: $('#eBy').value.trim(), featured: $('#eFeatured').checked,
  };
  $('#editDlg').close();
  try {
    toast('Saving…', { ms: 0 });
    if (m._new) {
      const item = clean({ id: uid(), type: 'quote', ...fields });
      await commitItems((list) => [...list, item], 'Add quote');
    } else {
      await commitItems((list) => list.map((x) => {
        if (x.id !== m.id) return x;
        const { title, text, tags, by, featured, ...rest } = x;
        return clean({ ...rest, ...fields });
      }), 'Edit moment');
    }
    toast('Saved. Public site refreshes in ~1 min.');
  } catch (e) { toast(`Save failed: ${e.message}`, { error: true, ms: 8000 }); }
}

async function deleteEdit() {
  const m = S.editing;
  if (!confirm(`Remove "${m.title || 'this moment'}" from the archive? (The media file stays in the repo history.)`)) return;
  $('#editDlg').close();
  try {
    toast('Removing…', { ms: 0 });
    await commitItems((list) => list.filter((x) => x.id !== m.id), 'Remove moment');
    toast('Removed.');
  } catch (e) { toast(`Remove failed: ${e.message}`, { error: true, ms: 8000 }); }
}

/* ---------------- wiring ---------------- */
function bindUI() {
  // filters
  $('#typeChips').addEventListener('click', (e) => {
    const t = e.target.closest('[data-type]')?.dataset.type;
    if (t) { S.filter.type = t; render(); }
  });
  $('#tagChips').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tag]')?.dataset.tag;
    if (t) { S.filter.tag = S.filter.tag === t ? null : t; render(); }
  });

  // cards
  $('#chapters').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const m = S.items.find((x) => x.id === card.dataset.id);
    if (e.target.closest('[data-edit]')) return openEdit(m);
    if (e.target.closest('[data-open]')) openLightbox(m.id);
  });
  $('#collage').addEventListener('click', (e) => {
    const id = e.target.closest('.pol')?.dataset.id;
    if (!id) return;
    S.filter = { type: 'all', tag: null };
    render();
    openLightbox(id);
  });

  // lightbox
  const lb = $('#lightbox');
  $('.lb-nav.prev').addEventListener('click', () => stepLightbox(-1));
  $('.lb-nav.next').addEventListener('click', () => stepLightbox(1));
  $('.lb-close').addEventListener('click', () => lb.close());
  lb.addEventListener('click', (e) => { if (e.target === lb) lb.close(); });
  lb.addEventListener('close', () => ($('#lbMedia').innerHTML = ''));
  document.addEventListener('keydown', (e) => {
    if (!lb.open) return;
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  });

  // media fallback: fresh uploads may not be on Pages yet -> load from raw.githubusercontent
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (el?.dataset?.raw && !el.src.startsWith(el.dataset.raw)) el.src = el.dataset.raw;
  }, true);

  // dialogs: close buttons + backdrop click
  $$('dialog.dlg').forEach((d) => d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  }));

  // login
  $('#loginBtn').addEventListener('click', () => (S.gh ? logout() : $('#loginDlg').showModal()));
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#loginErr');
    err.hidden = true;
    $('#loginSubmit').disabled = true;
    try {
      await login($('#tokenInput').value.trim());
      $('#tokenInput').value = '';
      $('#loginDlg').close();
      await loadItems();
      render();
    } catch (ex) {
      const { owner, repo } = S.cfg.github;
      err.textContent = ex.status === 401 ? 'GitHub rejected the token. Check you copied all of it.'
        : ex.status === 404 ? `Token can't see ${owner}/${repo}. Grant it access to this repo.` : ex.message;
      err.hidden = false;
    } finally { $('#loginSubmit').disabled = false; }
  });

  // editor buttons
  $('#addQuoteBtn').addEventListener('click', () => openEdit({ type: 'quote', _new: true }));
  $('#pickFiles').addEventListener('change', (e) => { openDrafts([...e.target.files]); e.target.value = ''; });

  // upload dialog
  $('#drafts').addEventListener('input', (e) => {
    const d = S.drafts.find((x) => x.id === e.target.closest('.draft')?.dataset.id);
    if (d && e.target.name) d[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  });
  $('#drafts').addEventListener('click', (e) => {
    if (!e.target.closest('.rm')) return;
    const id = e.target.closest('.draft').dataset.id;
    S.drafts = S.drafts.filter((d) => d.id !== id);
    if (S.drafts.length) renderDrafts(); else $('#uploadDlg').close();
  });
  $('#uploadDlg').addEventListener('close', () => { S.drafts = []; });
  $('#uploadForm').addEventListener('submit', (e) => { e.preventDefault(); publishDrafts(); });

  // edit dialog
  $('#editForm').addEventListener('submit', (e) => { e.preventDefault(); saveEdit(); });
  $('#eDelete').addEventListener('click', deleteEdit);

  // drag & drop anywhere
  const dz = $('#dropzone');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    $('#dropMsg').textContent = S.gh ? 'Drop to add moments' : 'Fan login needed to add moments';
    dz.hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; dz.hidden = true; } });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    dz.hidden = true;
    openDrafts([...e.dataTransfer.files]);
  });

  // paste screenshots
  window.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length && S.gh && !e.target.closest?.('input, textarea')) { e.preventDefault(); openDrafts(files); }
  });
}

async function boot() {
  S.cfg = await fetch('data/config.json', { cache: 'no-store' }).then((r) => r.json());
  const c = S.cfg;
  document.title = `${c.creator} · Fan Archive`;
  $('#brand').textContent = c.creator;
  $('#creator').textContent = c.creator;
  $('#tagline').textContent = c.tagline || '';
  $('#douyinId').textContent = c.douyinId;
  $('#douyin').href = `https://www.douyin.com/search/${encodeURIComponent(c.douyinId)}`;
  $('#rangeLabel').textContent = `${fmtDay(c.range.start)} – ${fmtDay(c.range.end)}, ${c.range.end.slice(0, 4)}`;
  $('#repoName').textContent = `${c.github.owner}/${c.github.repo}`;

  bindUI();

  const token = store.get(TOKEN_KEY);
  if (token) {
    try { await login(token, { silent: true }); } catch { store.del(TOKEN_KEY); }
  }
  try { await loadItems(); } catch (e) { toast(`Could not load moments: ${e.message}`, { error: true, ms: 8000 }); }
  render();
}

boot();
