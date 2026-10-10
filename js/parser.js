/* Tree text -> nested nodes -> flat file list */
(function (g) {
  const PREFIX = /^(?:[\s│├└┤┌┐┘┬┴┼|`]|─|--+|[-+*](?=\s))*/;
  const BAD = /[\\:*?"<>|]/;

  function parseTree(text) {
    const warnings = [], rows = [];
    text.split('\n').forEach((raw, i) => {
      let line = raw.replace(/\r/g, '').replace(/\t/g, '    ').replace(/\s+#.*$/, '');
      if (!line.trim()) return;
      const L = line.match(PREFIX)[0].length;
      let name = line.slice(L).trim().replace(/^`+|`+$/g, '').trim();
      const dir = name.endsWith('/');
      name = name.replace(/\/+$/, '').trim();
      if (!name) return;
      if (BAD.test(name) || name === '.' || name === '..') { warnings.push(`Line ${i + 1}: "${name}" skip kiya (invalid naam)`); return; }
      rows.push({ name, dir, L });
    });
    const pos = [...new Set(rows.map(r => r.L).filter(l => l > 0))].sort((a, b) => a - b);
    const unit = pos[0] || 1;
    rows.forEach(r => (r.depth = Math.round(r.L / unit)));
    const min = rows.length ? Math.min(...rows.map(r => r.depth)) : 0;
    const roots = [], stack = [];
    for (const r of rows) {
      r.depth -= min;
      const node = { name: r.name, type: r.dir ? 'folder' : 'file', children: [] };
      while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
      const list = stack.length ? stack[stack.length - 1].node.children : roots;
      if (stack.length) stack[stack.length - 1].node.type = 'folder';
      const dup = list.find(n => n.name === node.name);
      if (dup) {
        if (dup.type === 'folder' && node.type === 'folder') { stack.push({ node: dup, depth: r.depth }); continue; }
        warnings.push(`Duplicate "${node.name}" skip kiya`); continue;
      }
      list.push(node);
      stack.push({ node, depth: r.depth });
    }
    return { roots, warnings };
  }

  function starter(name, project) {
    if (name === 'README.md') return `# ${project}\n`;
    if (name === '.gitignore') return 'node_modules/\n.env\n.DS_Store\n';
    if (name === 'package.json') return JSON.stringify({ name: project.toLowerCase().replace(/[^a-z0-9-_]/g, '-'), version: '0.1.0', private: true }, null, 2) + '\n';
    return '';
  }

  function flatten(nodes, o, base = '') {
    const out = [];
    for (const n of nodes) {
      const p = base ? base + '/' + n.name : n.name;
      if (n.type === 'folder') {
        if (n.children.length) out.push(...flatten(n.children, o, p));
        else if (o.gitkeep) out.push({ path: p + '/.gitkeep', content: '' });
      } else out.push({ path: p, content: o.starter ? starter(n.name, o.name) : '' });
    }
    return out;
  }

  function fromPaths(paths) {
    const roots = [];
    for (const path of paths) {
      let list = roots;
      path.split('/').forEach((seg, i, a) => {
        const last = i === a.length - 1;
        let n = list.find(x => x.name === seg);
        if (!n) list.push((n = { name: seg, type: last ? 'file' : 'folder', children: [] }));
        list = n.children;
      });
    }
    const sort = l => { l.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1)); l.forEach(n => sort(n.children)); };
    sort(roots);
    return roots;
  }

  function count(nodes) {
    let f = 0, d = 0;
    (function w(l) { for (const n of l) n.type === 'folder' ? (d++, w(n.children)) : f++; })(nodes);
    return { files: f, folders: d };
  }

  // Agar saari files ek hi top folder mein hain to wo folder hata do (repo root = project)
  function stripRoot(files) {
    if (!files.length) return files;
    const first = files[0].path.split('/')[0];
    if (files.every(f => f.path.includes('/') && f.path.split('/')[0] === first))
      return files.map(f => ({ ...f, path: f.path.slice(first.length + 1) }));
    return files;
  }

  g.TF = Object.assign(g.TF || {}, { parseTree, flatten, fromPaths, count, stripRoot });
})(window);
