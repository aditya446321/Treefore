(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CATS = {
    code: 'js jsx ts tsx py kt java go rs c cpp h cs php rb swift sh gradle kts dart lua',
    web: 'html htm css scss sass vue svelte xml',
    data: 'json yml yaml toml md txt csv lock env gitignore ini conf',
    media: 'png jpg jpeg gif webp svg ico mp3 mp4 wav mov pdf ttf otf woff woff2'
  };
  const EXT = {}; Object.entries(CATS).forEach(([c, l]) => l.split(' ').forEach(e => (EXT[e] = c)));
  const cat = n => EXT[(n.includes('.') ? n.split('.').pop() : '').toLowerCase()] || 'other';
  const SKIP = /(^|\/)(\.git|node_modules|\.DS_Store)(\/|$)/;
  const TOK = 'treeforge_token', USR = 'treeforge_user';
  const SAMPLE = `my-app/
├── src/
│   ├── components/
│   │   └── Button.jsx
│   ├── App.jsx
│   └── main.jsx
├── public/
│   └── index.html
├── package.json
├── .gitignore
└── README.md`;

  const S = { nameTouched: false, msgTouched: false, mode: 'paste', roots: [], files: [], warns: [], upload: [], token: '', user: null, repos: [], repo: null, target: 'existing', busy: false, loading: false, reposLoaded: false };
  const store = {
    get: k => { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } },
    set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (_) {} }
  };
  const projName = () => ($('projName').value.trim().replace(/[^\w.-]/g, '-') || 'project');

  function toast(msg, type = 'info') {
    const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
    $('toasts').appendChild(t); setTimeout(() => t.remove(), 4000);
  }
  const show = (el, msg) => { el.textContent = msg || ''; el.hidden = !msg; };

  /* ---------- tree + files ---------- */
  const GI = { node: 'node_modules/\ndist/\n.env\n', py: '__pycache__/\n*.pyc\n.venv/\n.env\n', android: '.gradle/\nbuild/\nlocal.properties\n.idea/\n', '': '.env\n' };
  function extras(files, name) {
    const tops = new Set(files.map(f => f.path.split('/')[0]));
    const top = files.length && files.every(f => f.path.includes('/')) && tops.size === 1 ? [...tops][0] + '/' : '';
    const has = n => files.some(f => f.path === top + n), add = [];
    const kind = files.some(f => /(^|\/)package\.json$/.test(f.path)) ? 'node' : files.some(f => /\.py$|pyproject\.toml$/.test(f.path)) ? 'py' : files.some(f => /\.kts?$|build\.gradle/.test(f.path)) ? 'android' : '';
    if (!has('README.md')) add.push({ path: top + 'README.md', content: `# ${name}\n` });
    if (!has('.gitignore')) add.push({ path: top + '.gitignore', content: GI[kind] + '.DS_Store\n' });
    return add;
  }
  function autoName() {
    if (S.nameTouched) return;
    const tops = new Set(S.files.map(f => f.path.split('/')[0]));
    const multi = S.files.every(f => f.path.includes('/'));
    if (S.files.length && multi && tops.size === 1) $('projName').value = [...tops][0].replace(/[^\w.-]/g, '-').slice(0, 60);
  }
  function recompute() {
    S.auto = [];
    if (S.mode === 'paste') {
      const p = TF.parseTree($('treeText').value);
      S.warns = p.warnings;
      S.files = TF.flatten(p.roots, { gitkeep: $('gitkeep').checked, starter: $('starter').checked, name: projName() });
      autoName();
      if ($('starter').checked) { const ex = extras(S.files, projName()); S.files = S.files.concat(ex); S.auto = ex.map(f => f.path.split('/').pop()); }
      store.set('tf_draft', JSON.stringify({ t: $('treeText').value, n: $('projName').value, nt: S.nameTouched }));
    } else { S.files = S.upload; S.warns = []; autoName(); }
    S.roots = TF.fromPaths(S.files.map(f => f.path));
    render();
  }

  function filterNodes(nodes, q) {
    if (!q) return nodes;
    return nodes.map(n => {
      if (n.name.toLowerCase().includes(q)) return n;
      if (n.type === 'folder') { const c = filterNodes(n.children, q); if (c.length) return { ...n, children: c }; }
      return null;
    }).filter(Boolean);
  }
  function nodeHtml(n, open) {
    if (n.type !== 'folder') return `<div class="f" data-c="${cat(n.name)}">${esc(n.name)}</div>`;
    return `<details${open ? ' open' : ''}><summary>${esc(n.name)}/</summary>${n.children.map(c => nodeHtml(c, open)).join('')}</details>`;
  }
  function render() {
    const q = $('filter').value.trim().toLowerCase();
    const nodes = filterNodes(S.roots, q);
    $('tree').innerHTML = nodes.length ? nodes.map(n => nodeHtml(n, true)).join('') : `<div class="empty">${S.roots.length ? 'No matches.' : 'Nothing here yet. Paste a tree or upload a folder.'}</div>`;
    const c = TF.count(S.roots);
    $('counts').textContent = `${c.folders} folders · ${S.files.length} files`;
    $('autoNote').innerHTML = S.auto && S.auto.length ? `<b>Auto-added:</b> ${S.auto.map(esc).join(', ')}` : '';
    renderWarns();
    const has = S.files.length > 0;
    $('zipBtn').disabled = !has; $('pushBtn').disabled = !has;
  }

  /* ---------- friendly checks ---------- */
  function renderWarns() {
    const box = $('warns'), w = S.mode === 'paste' ? S.warns : [];
    if (!w.length) { box.hidden = true; box.innerHTML = ''; return; }
    const fixable = w.filter(x => x.fix !== null).length;
    box.innerHTML = `<div class="wh"><b>${w.length} thing${w.length > 1 ? 's' : ''} to check</b>${fixable ? `<button type="button" class="btn sm primary" id="fixAll">Fix ${fixable}</button>` : ''}</div>`
      + w.slice(0, 5).map(x => `<button type="button" class="wi" data-line="${x.line}"><span>${esc(x.msg)}</span>${x.how ? `<small>How to fix: ${esc(x.how)}</small>` : ''}</button>`).join('')
      + (w.length > 5 ? `<div class="more">+${w.length - 5} more. Fix these first.</div>` : '');
    box.hidden = false;
  }
  function jumpTo(n) {
    const ta = $('treeText'), lines = ta.value.split('\n'); let s = 0;
    for (let i = 0; i < n && i < lines.length; i++) s += lines[i].length + 1;
    ta.focus(); ta.setSelectionRange(s, s + (lines[n] || '').length);
    ta.scrollTop = Math.max(0, n * 19.5 - 70);
  }
  function fixAll() {
    const ta = $('treeText'); let txt = ta.value;
    for (let k = 0; k < 3; k++) {
      const p = TF.parseTree(txt);
      if (!p.warnings.some(w => w.fix !== null)) break;
      const nt = TF.applyFixes(txt, p.warnings); if (nt === txt) break; txt = nt;
    }
    ta.value = txt; recompute(); toast('Fixed', 'success');
  }

  /* ---------- tree writing helpers ---------- */
  function setupEditor() {
    const ta = $('treeText');
    const bounds = pos => { const v = ta.value, s = pos ? v.lastIndexOf('\n', pos - 1) + 1 : 0; let e = v.indexOf('\n', pos); if (e < 0) e = v.length; return [s, e]; };
    const insert = text => { ta.focus(); if (!document.execCommand || !document.execCommand('insertText', false, text)) { ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end'); } recompute(); };
    const isDir = l => /\/\s*$/.test(l.replace(/\s+#.*$/, ''));

    function addItem(kind) {
      const v = ta.value, [s, e] = bounds(ta.selectionEnd), cur = v.slice(s, e), has = cur.trim().length > 0;
      const indent = has ? ' '.repeat(TF.prefixLen(cur) + (isDir(cur) ? 4 : 0)) : '';
      const nm = kind === 'folder' ? 'new-folder' : 'new-file.txt', text = indent + nm + (kind === 'folder' ? '/' : '');
      const ins = (has ? '\n' : '') + text;
      ta.value = v.slice(0, e) + ins + v.slice(e);
      const a = e + (has ? 1 : 0) + indent.length; ta.focus(); ta.setSelectionRange(a, a + nm.length); recompute();
    }
    function shift(dir) {
      const v = ta.value, a = bounds(ta.selectionStart)[0];
      const endPos = ta.selectionEnd > ta.selectionStart && v[ta.selectionEnd - 1] === '\n' ? ta.selectionEnd - 1 : ta.selectionEnd;
      const b = bounds(endPos)[1], old = v.slice(a, b);
      const seg = old.split('\n').map(l => {
        if (!l.trim()) return l;
        l = l.replace(/\t/g, '    ');
        return dir > 0 ? '    ' + l : (TF.prefixLen(l) >= 4 ? l.slice(4) : l.replace(/^ +/, ''));
      }).join('\n');
      const collapsed = ta.selectionStart === ta.selectionEnd, caret = Math.max(a, ta.selectionStart + seg.length - old.length);
      ta.value = v.slice(0, a) + seg + v.slice(b);
      ta.focus(); collapsed ? ta.setSelectionRange(caret, caret) : ta.setSelectionRange(a, a + seg.length); recompute();
    }
    function tidy() {
      const p = TF.parseTree(ta.value);
      if (!p.roots.length) return toast('Nothing to tidy yet', 'error');
      ta.value = TF.toText(p.roots); recompute(); toast('Lines redrawn', 'success');
    }
    function clear() { ta.focus(); ta.select(); if (!document.execCommand || !document.execCommand('delete')) ta.value = ''; S.nameTouched = false; recompute(); }

    const act = { folder: () => addItem('folder'), file: () => addItem('file'), in: () => shift(1), out: () => shift(-1), tidy, clear };
    const tools = $('tools');
    tools.addEventListener('mousedown', e => e.preventDefault()); // keep the keyboard open on phones
    tools.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ins) insert(b.dataset.ins); else if (act[b.dataset.t]) act[b.dataset.t]();
    });
    ta.addEventListener('keydown', e => {
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); shift(e.shiftKey ? -1 : 1); }
    });
    // Enter keeps your indent (and goes one level deeper after a folder). beforeinput also works with phone keyboards.
    ta.addEventListener('beforeinput', e => {
      if (e.inputType !== 'insertLineBreak' && e.inputType !== 'insertParagraph') return;
      if (ta.selectionStart !== ta.selectionEnd) return;
      const [s, en] = bounds(ta.selectionStart);
      const rest = ta.value.slice(ta.selectionStart, en);
      if (rest !== '' && rest !== '/') return; // only when the caret is at the end of the line
      const cur = ta.value.slice(s, en); if (!cur.trim()) return;
      e.preventDefault(); if (rest) ta.setSelectionRange(en, en);
      insert('\n' + ' '.repeat(TF.prefixLen(cur) + (isDir(cur) ? 4 : 0)));
    });
    $('warns').addEventListener('click', e => {
      if (e.target.closest('#fixAll')) return fixAll();
      const w = e.target.closest('[data-line]'); if (w) jumpTo(+w.dataset.line);
    });
    $('guideLink').onclick = () => $('helpDlg').showModal();
  }

  /* ---------- upload ---------- */
  function setUpload(list) {
    const items = []; let skipped = 0;
    for (const f of list) {
      const path = (f._path || f.webkitRelativePath || f.name).replace(/^\/+/, '');
      if (SKIP.test(path)) { skipped++; continue; }
      if (f.size > 100 * 1024 * 1024) { toast(`${f.name} is over 100 MB and was skipped`, 'error'); continue; }
      items.push({ path, file: f, size: f.size });
    }
    S.upload = items;
    renderStats(items, skipped);
    recompute();
  }
  function renderStats(items, skipped) {
    const box = $('uploadInfo'); box.hidden = !items.length; if (!items.length) return;
    const total = items.reduce((a, i) => a + i.size, 0), by = {};
    items.forEach(i => { const c = cat(i.path.split('/').pop()); by[c] = (by[c] || 0) + 1; });
    const names = { code: 'Code', web: 'Web', data: 'Config & docs', media: 'Media', other: 'Other' };
    const keys = Object.keys(names).filter(k => by[k]);
    const size = total > 1048576 ? (total / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(total / 1024)) + ' KB';
    box.innerHTML = `<div class="stats"><div class="stat"><b id="cnt">0</b><span>files</span></div><div class="stat"><b>${size}</b><span>total</span></div><div class="stat"><b>${TF.count(TF.fromPaths(items.map(i => i.path))).folders}</b><span>folders</span></div></div>
      <div class="mix">${keys.map(k => `<i class="cd-${k}" style="flex:${by[k]}" title="${names[k]}"></i>`).join('')}</div>
      <div class="legend">${keys.map(k => `<span class="cd-${k}">${names[k]} · ${by[k]}</span>`).join('')}${skipped ? `<span>${skipped} skipped</span>` : ''}</div>`;
    const el = $('cnt'), t0 = performance.now();
    (function tick(t) { const p = Math.min(1, (t - t0) / 700); el.textContent = Math.round(items.length * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); })(t0);
  }
  async function readEntry(entry, base = '') {
    if (entry.isFile) return new Promise(res => entry.file(f => { f._path = base + f.name; res([f]); }, () => res([])));
    if (!entry.isDirectory) return [];
    const rd = entry.createReader(), kids = [];
    for (;;) { const b = await new Promise(r => rd.readEntries(r, () => r([]))); if (!b.length) break; kids.push(...b); }
    return (await Promise.all(kids.map(k => readEntry(k, base + entry.name + '/')))).flat();
  }

  /* ---------- ZIP ---------- */
  async function downloadZip() {
    if (S.busy) return; S.busy = true; $('zipBtn').disabled = true;
    try {
      const name = projName();
      let files = S.files;
      const top = new Set(files.map(f => f.path.split('/')[0]));
      if (!(top.size === 1 && files.every(f => f.path.includes('/')))) files = files.map(f => ({ ...f, path: name + '/' + f.path }));
      const entries = [];
      for (const f of files) entries.push({ path: f.path, data: f.file ? new Uint8Array(await f.file.arrayBuffer()) : new TextEncoder().encode(f.content || '') });
      const blob = await TF.makeZip(entries);
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name + '.zip';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      toast(`${name}.zip downloaded`, 'success');
    } catch (e) { toast(e.message || 'ZIP failed', 'error'); }
    finally { S.busy = false; $('zipBtn').disabled = !S.files.length; }
  }

  /* ---------- GitHub: connection ---------- */
  // The token is saved until GitHub itself rejects it (401). Network problems never log you out.
  function ghStatus() {
    $('accBtn').hidden = !S.user;
    if (S.user) {
      const n = S.user.login && S.user.login !== 'GitHub' ? S.user.login : '';
      $('accName').textContent = n || 'Connected'; $('accInfo').textContent = n ? `Connected as ${n}.` : 'Connected to GitHub.';
    }
    $('pushBtn').textContent = S.user ? 'Choose repo & push' : 'Connect & push';
  }
  function disconnect() {
    S.token = ''; S.user = null; S.repos = []; S.repo = null; S.reposLoaded = false;
    store.set(TOK, ''); store.set(USR, ''); ghStatus(); if ($('accDlg').open) $('accDlg').close(); toast('Disconnected. Token removed from this device.');
  }
  function expired() {
    disconnect();
    if ($('pushDlg').open) $('pushDlg').close();
    show($('connectErr'), 'Your GitHub token expired or was revoked. Paste a new one to continue.');
    $('connectDlg').showModal();
  }
  async function doConnect(token) {
    const r = await TF.gh.connect(token);
    S.token = token; S.user = { login: r.user.login };
    store.set(TOK, token); store.set(USR, JSON.stringify(S.user));
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (_) {}
    S.repos = []; S.reposLoaded = false; ghStatus();
    return r;
  }

  /* ---------- GitHub: repos ---------- */
  function renderRepos() {
    const q = $('repoSearch').value.toLowerCase();
    const list = S.repos.filter(r => r.full_name.toLowerCase().includes(q));
    $('repoList').innerHTML = list.length ? list.map(r =>
      `<button type="button" class="repo${S.repo && S.repo.full_name === r.full_name ? ' on' : ''}" data-repo="${esc(r.full_name)}"><span>${esc(r.full_name)}${r.private ? ' 🔒' : ''}</span><small>${esc(r.default_branch || '')}</small></button>`).join('')
      : `<div class="empty muted pad">${S.loading ? 'Loading your repos...' : S.reposLoaded ? 'No repos found. Try “New repo”.' : ''}</div>`;
  }
  async function loadRepos() {
    if (S.loading) return; S.loading = true; renderRepos();
    try {
      await TF.gh.listRepos(S.token, list => { S.repos = list; renderRepos(); });
      S.reposLoaded = true;
    } catch (e) {
      S.loading = false;
      if (e.status === 401) return expired();
      $('repoList').innerHTML = `<div class="empty muted pad">Couldn't load repos (${esc(e.message)}). <button type="button" class="link" id="retryRepos">Retry</button></div>`;
      return;
    }
    S.loading = false; autoPick();
  }
  function setTarget(t) {
    S.target = t;
    document.querySelectorAll('[data-target]').forEach(x => x.classList.toggle('on', x.dataset.target === t));
    $('existingBox').hidden = t !== 'existing'; $('newBox').hidden = t !== 'new';
    $('repoNote').textContent = t === 'new' ? 'A fresh repo is created and filled automatically.' : 'Empty repo? No problem. It is detected and set up automatically.';
  }
  function autoPick() {
    if (!S.repo && (S.repos.length || S.reposLoaded)) {
      let last = null; try { last = JSON.parse(store.get('tf_last') || 'null'); } catch (_) {}
      const name = projName().toLowerCase();
      const r = S.repos.find(x => last && x.full_name === last.repo) || S.repos.find(x => x.name.toLowerCase() === name);
      if (r) { S.repo = r; $('branch').value = (last && last.repo === r.full_name && last.branch) || r.default_branch || 'main'; setTarget('existing'); }
      else { setTarget('new'); $('branch').value = $('branch').value || 'main'; }
    }
    renderRepos();
  }
  async function openPush() {
    if (!S.token) { show($('connectErr'), ''); $('connectDlg').showModal(); return; }
    $('fileCount').textContent = TF.stripRoot(S.files).length + ' files';
    if (!$('newName').value) $('newName').value = projName();
    show($('pushErr'), ''); $('step').textContent = ''; $('bar').hidden = true; $('barFill').style.width = '0';
    $('pushForm').hidden = false; $('pushDone').hidden = true;
    if (!S.msgTouched) $('commitMsg').value = `Add ${projName()} via TreeForge`;
    autoPick(); $('pushDlg').showModal();
    if (!S.reposLoaded) loadRepos();
  }

  /* ---------- GitHub: push + success card ---------- */
  function renderDone(r) {
    const n = (v, w) => `${v} ${w}${v === 1 ? '' : 's'}`;
    $('pushDone').innerHTML = `<div class="done">
      <div class="tick"><svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <h3>Pushed to GitHub</h3>
      <p class="mono repo-id">${esc(r.repoName)} · ${esc(r.branch)}</p>
      <div class="chips"><span>${n(r.files, 'file')}</span><span>${n(r.commits, 'commit')}</span><span class="mono">${esc(r.sha.slice(0, 7))}</span>${r.initialized ? '<span class="auto">empty repo set up automatically</span>' : ''}</div>
      <a class="btn primary big" href="${esc(r.repoUrl)}" target="_blank" rel="noopener">Open repo</a>
      <div class="grid2"><a class="btn" href="${esc(r.commitUrl)}" target="_blank" rel="noopener">View commit</a><button type="button" class="btn" data-copy="${esc(r.repoUrl)}">Copy link</button></div>
      <button type="button" class="btn ghost" data-close>Done</button>
    </div>`;
    $('pushForm').hidden = true; $('pushDone').hidden = false;
  }
  async function doPush() {
    show($('pushErr'), '');
    const isNew = S.target === 'new', newName = $('newName').value.trim().replace(/\s+/g, '-');
    if (isNew && !/^[\w.-]+$/.test(newName)) return show($('pushErr'), 'Repo names can only use letters, numbers, - _ and .');
    if (!isNew && !S.repo) return show($('pushErr'), 'Select a repo from the list first.');
    const btn = $('doPush'); btn.disabled = true; $('bar').hidden = false;
    try {
      const r = await TF.gh.push({
        token: S.token, repo: isNew ? null : S.repo, newName, isPrivate: $('isPrivate').checked,
        branch: $('branch').value.trim(), message: $('commitMsg').value.trim(), files: TF.stripRoot(S.files),
        onStep: m => ($('step').textContent = m),
        onProgress: (c, t) => ($('barFill').style.width = (c / Math.max(1, t)) * 100 + '%')
      });
      renderDone(r);
      try { navigator.clipboard.writeText(r.repoUrl).then(() => toast('Repo link copied', 'success'), () => {}); } catch (_) {}
      store.set('tf_last', JSON.stringify({ repo: r.repoName, branch: r.branch }));
      if (isNew) { S.repo = null; S.reposLoaded = false; }
    } catch (e) {
      if (e.status === 401) return expired();
      show($('pushErr'), e.message || 'Push failed'); $('step').textContent = '';
    } finally { btn.disabled = false; }
  }

  /* ---------- wiring ---------- */
  function init() {
    let dr = null; try { dr = JSON.parse(store.get('tf_draft') || 'null'); } catch (_) {}
    $('treeText').value = dr && dr.t ? dr.t : SAMPLE;
    if (dr && dr.n) { $('projName').value = dr.n; S.nameTouched = !!dr.nt; }
    $('projName').addEventListener('input', () => (S.nameTouched = true));
    $('commitMsg').addEventListener('input', () => (S.msgTouched = true));
    let t; const deb = () => { clearTimeout(t); t = setTimeout(recompute, 150); };
    ['treeText', 'projName'].forEach(id => $(id).addEventListener('input', deb));
    ['gitkeep', 'starter'].forEach(id => $(id).addEventListener('change', recompute));
    $('filter').addEventListener('input', render);
    setupEditor();

    function setMode(m) {
      S.mode = m;
      document.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('on', x.dataset.mode === m));
      $('pasteBox').hidden = m !== 'paste'; $('uploadBox').hidden = m !== 'upload'; recompute();
    }
    document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    $('pickFolder').onclick = () => $('folderInput').click();
    $('pickFiles').onclick = () => $('filesInput').click();
    $('folderInput').onchange = e => setUpload([...e.target.files]);
    $('filesInput').onchange = e => setUpload([...e.target.files]);
    const drop = $('drop');
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    async function loadDrop(dt) {
      setMode('upload'); drop.classList.add('busy');
      const items = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      if (items.length) setUpload((await Promise.all(items.map(i => readEntry(i)))).flat()); else setUpload([...dt.files]);
      setTimeout(() => drop.classList.remove('busy'), 500);
      toast('Folder loaded', 'success');
    }
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); };
    let dc = 0; const all = $('dropAll');
    const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', e => { if (hasFiles(e)) { dc++; all.hidden = false; } });
    window.addEventListener('dragleave', e => { if (hasFiles(e) && --dc <= 0) { dc = 0; all.hidden = true; } });
    window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); dc = 0; all.hidden = true; loadDrop(e.dataTransfer); });

    document.addEventListener('paste', e => {
      const el = e.target, txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
      if (el === $('tokenInput')) { setTimeout(() => /^(ghp_|github_pat_|gho_)/.test($('tokenInput').value.trim()) && $('connectBtn').click(), 50); return; }
      if (/^(INPUT|TEXTAREA)$/.test(el.tagName) || document.querySelector('dialog[open]')) return;
      const lines = txt.split('\n').filter(l => l.trim());
      if (lines.length >= 2 && lines.some(l => /[├└│]|\/\s*$|^\s{2,}\S/.test(l))) {
        e.preventDefault(); S.nameTouched = false; setMode('paste'); $('treeText').value = txt.replace(/^\s*```.*\n?/gm, '').trimEnd(); recompute(); toast('Tree detected from clipboard', 'success');
      }
    });
    $('ctaPaste').onclick = () => { setMode('paste'); $('app').scrollIntoView({ behavior: 'smooth' }); setTimeout(() => $('treeText').focus(), 400); };
    $('ctaDrop').onclick = () => { setMode('upload'); $('app').scrollIntoView({ behavior: 'smooth' }); $('folderInput').click(); };

    $('zipBtn').onclick = downloadZip;
    $('pushBtn').onclick = openPush;
    $('helpBtn').onclick = () => $('helpDlg').showModal();
    document.addEventListener('click', e => {
      const c = e.target.closest('[data-close]'); if (c) { c.closest('dialog').close(); return; }
      const cp = e.target.closest('[data-copy]');
      if (cp) { try { navigator.clipboard.writeText(cp.dataset.copy).then(() => (cp.textContent = 'Copied ✓'), () => (cp.textContent = 'Copy failed')); } catch (_) { cp.textContent = 'Copy failed'; } return; }
      if (e.target.closest('#retryRepos')) loadRepos();
    });
    document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

    $('connectBtn').onclick = async () => {
      const tk = $('tokenInput').value.trim(); if (!tk) return show($('connectErr'), 'Enter a token.');
      $('connectBtn').disabled = true; show($('connectErr'), '');
      try {
        const r = await doConnect(tk);
        $('tokenInput').value = ''; $('connectDlg').close();
        toast('Connected as ' + r.user.login, 'success'); if (r.warn) toast(r.warn, 'error');
        openPush();
      } catch (e) { show($('connectErr'), e.message || 'Could not connect'); }
      $('connectBtn').disabled = false;
    };
    $('accBtn').onclick = () => $('accDlg').showModal();
    $('disBtn').onclick = disconnect;
    document.querySelectorAll('[data-target]').forEach(b => b.onclick = () => setTarget(b.dataset.target));
    $('repoSearch').addEventListener('input', renderRepos);
    $('repoList').onclick = e => {
      const b = e.target.closest('[data-repo]'); if (!b) return;
      S.repo = S.repos.find(r => r.full_name === b.dataset.repo);
      $('branch').value = S.repo.default_branch || 'main'; renderRepos();
    };
    $('doPush').onclick = doPush;

    // Restore the saved connection without any network call: nothing extra loads with the page.
    const saved = store.get(TOK);
    if (saved) { S.token = saved; try { S.user = JSON.parse(store.get(USR) || 'null'); } catch (_) {} if (!S.user) S.user = { login: '' }; }
    recompute(); ghStatus();
  }
  init();
})();
