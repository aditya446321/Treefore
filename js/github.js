/* GitHub push: blobs -> tree -> commit -> ref (handles empty repos) */
(function (g) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const MSG = {
    401: 'Bad or expired token. Create a new one.',
    403: 'Permission denied or rate limited. Give the token the "repo" scope (or Contents: Read & write).',
    404: 'Repo not found, or the token has no access to it.',
    422: 'GitHub rejected the request (name taken or branch protected).'
  };

  async function api(token, path, opt = {}) {
    const url = path.startsWith('http') ? path : 'https://api.github.com' + path;
    for (let i = 0; ; i++) {
      let res;
      try {
        res = await fetch(url, { ...opt, headers: {
          Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          Authorization: 'Bearer ' + token, ...(opt.body ? { 'Content-Type': 'application/json' } : {}) } });
      } catch (e) { throw new Error('Network error. Check your connection.'); }
      const data = await res.json().catch(() => ({}));
      const limited = (res.status === 403 || res.status === 429) && /rate limit|abuse|secondary/i.test(data.message || '');
      if (limited && i < 3) { await sleep(Math.min(+res.headers.get('retry-after') || 5 * (i + 1), 60) * 1000); continue; }
      return { res, data };
    }
  }
  const fail = (r, what) => { throw new Error(`${what}: ${r.data.message || MSG[r.res.status] || 'error ' + r.res.status}`); };

  async function connect(token) {
    const r = await api(token, '/user');
    if (!r.res.ok) throw new Error(r.res.status === 401 ? MSG[401] : r.data.message || 'Could not connect');
    const scopes = r.res.headers.get('x-oauth-scopes');
    return { user: r.data, warn: scopes !== null && !/(^|,\s*)(repo|public_repo)(,|$)/.test(scopes) ? 'This token seems to lack the "repo" scope. Pushing may fail.' : '' };
  }

  async function listRepos(token) {
    let all = [];
    for (let p = 1; p <= 5; p++) {
      const r = await api(token, `/user/repos?per_page=100&page=${p}&sort=updated`);
      if (!r.res.ok) break;
      all = all.concat(r.data);
      if (r.data.length < 100) break;
    }
    return all;
  }

  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };

  async function push(o) { // {token, repo|null, newName, isPrivate, branch, message, files, onStep, onProgress}
    const { token, files, onStep, onProgress } = o;
    let repo = o.repo;
    if (!files.length) throw new Error('No files to push.');
    if (!repo) {
      onStep(`Creating repo "${o.newName}"...`);
      const r = await api(token, '/user/repos', { method: 'POST', body: JSON.stringify({ name: o.newName, private: o.isPrivate, auto_init: false }) });
      if (!r.res.ok) {
        if (r.res.status === 422) throw new Error('A repo with this name already exists. Pick another name.');
        fail(r, 'Could not create repo');
      }
      repo = r.data;
    }
    const full = repo.full_name, def = repo.default_branch || 'main', branch = o.branch || def;
    const R = p => `/repos/${full}${p}`;
    const enc = s => s.split('/').map(encodeURIComponent).join('/');

    onStep('Checking branch...');
    let parent = null, refExists = false;
    let r = await api(token, R('/git/ref/heads/' + enc(branch)));
    if (r.res.ok) { parent = r.data.object.sha; refExists = true; }
    else if (r.res.status !== 404 && r.res.status !== 409) fail(r, 'Branch check failed');
    else if (branch !== def) {
      const d = await api(token, R('/git/ref/heads/' + enc(def)));
      if (d.res.ok) parent = d.data.object.sha;
    }

    let bootstrap = false;
    if (!parent) { // empty repo: the Git Data API needs a first commit
      onStep('Empty repo found. Creating the first commit...');
      const body = { message: 'Initialize repository', content: btoa('init') };
      if (branch === def) body.branch = branch;
      const c = await api(token, R('/contents/.treeforge-init'), { method: 'PUT', body: JSON.stringify(body) });
      if (!c.res.ok) fail(c, 'Could not initialize the empty repo');
      parent = c.data.commit.sha; bootstrap = true;
      if (branch === def) refExists = true;
    }

    const pc = await api(token, R('/git/commits/' + parent));
    if (!pc.res.ok) fail(pc, 'Parent commit not found');
    const baseTree = pc.data.tree.sha;

    onStep('Uploading files...');
    const tree = new Array(files.length); let done = 0, idx = 0;
    onProgress(0, files.length);
    async function worker() {
      while (idx < files.length) {
        const i = idx++, f = files[i];
        const bytes = f.file ? new Uint8Array(await f.file.arrayBuffer()) : new TextEncoder().encode(f.content || '');
        const b = await api(token, R('/git/blobs'), { method: 'POST', body: JSON.stringify({ content: b64(bytes), encoding: 'base64' }) });
        if (!b.res.ok) fail(b, `"${f.path}" failed to upload`);
        tree[i] = { path: f.path, mode: '100644', type: 'blob', sha: b.data.sha };
        onProgress(++done, files.length);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (bootstrap && !files.some(f => f.path === '.treeforge-init')) tree.push({ path: '.treeforge-init', mode: '100644', type: 'blob', sha: null });

    onStep('Building tree and commit...');
    const t = await api(token, R('/git/trees'), { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree }) });
    if (!t.res.ok) fail(t, 'Could not create tree');
    const c = await api(token, R('/git/commits'), { method: 'POST', body: JSON.stringify({ message: o.message || 'Add project via TreeForge', tree: t.data.sha, parents: [parent] }) });
    if (!c.res.ok) fail(c, 'Could not create commit');

    onStep('Updating branch...');
    const u = refExists
      ? await api(token, R('/git/refs/heads/' + enc(branch)), { method: 'PATCH', body: JSON.stringify({ sha: c.data.sha }) })
      : await api(token, R('/git/refs'), { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + branch, sha: c.data.sha }) });
    if (!u.res.ok) fail(u, 'Could not update branch');
    return { repoUrl: repo.html_url, commitUrl: `${repo.html_url}/commit/${c.data.sha}`, sha: c.data.sha };
  }
  g.TF = Object.assign(g.TF || {}, { gh: { connect, listRepos, push } });
})(window);
