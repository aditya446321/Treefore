/* Tree text -> nested nodes -> flat file list (with friendly checks) */
(function (g) {
  const PREFIX = /^(?:[\s│├└┤┌┐┘┬┴┼|`]|─|\+?--+|[-+*](?=\s))*/;
  const BADC = /[:*?"<>|]/;
  const FILE_LIKE = /[^.]\.[A-Za-z0-9]{1,8}$/;
  const prefixLen = line => line.replace(/\t/g, '    ').match(PREFIX)[0].length;

  // Indent step: 4 (tree/most editors), 3, 2, else 1. Tolerates a few odd lines.
  function pickUnit(Ls) {
    const pos = Ls.filter(l => l > 0);
    if (!pos.length) return 4;
    for (const u of [4, 3, 2]) if (pos.filter(l => l % u).length <= pos.length * 0.2) return u;
    return 1;
  }

  // warning = { line (0-based), msg, how, fix }  fix: null = none, '' = delete line, string = replacement line
  function parseTree(text) {
    const warnings = [], rows = [];
    const warn = (line, msg, how, fix) => warnings.push({ line, msg, how: how || '', fix: fix === undefined ? null : fix });

    text.split('\n').forEach((raw, i) => {
      if (/^\s*```/.test(raw) || /^\s*#/.test(raw)) return;
      const line = raw.replace(/\r/g, '').replace(/\t/g, '    ').replace(/\s+#.*$/, '');
      if (!line.trim()) return;
      const L = line.match(PREFIX)[0].length, prefix = line.slice(0, L);
      let name = line.slice(L).trim().replace(/^`+|`+$/g, '').trim();
      const dir = /[\\/]$/.test(name);
      name = name.replace(/[\\/]+$/, '').trim();
      if (!name) {
        if (/[\\/]/.test(line)) warn(i, `Line ${i + 1} has a symbol but no name.`, 'Write a name after it: "src/" for a folder, "index.js" for a file.', '');
        return;
      }
      const orig = name, notes = [];
      if (name.includes('\\')) { name = name.replace(/\\/g, '/'); notes.push('folders are separated with /, not \\'); }
      if (/^\.?\//.test(name)) { name = name.replace(/^(\.?\/)+/, ''); notes.push('paths must be relative, so the leading / was removed'); }
      if (/\/{2,}/.test(name)) { name = name.replace(/\/{2,}/g, '/'); notes.push('double // collapsed'); }
      if (!name) return;

      if (BADC.test(name)) {
        const safe = name.replace(/[:*?"<>|]/g, '-');
        warn(i, `Line ${i + 1}: "${orig}" has a character that files can't contain ( : * ? " < > | ). Skipped.`, `Rename it, for example "${safe}".`, prefix + safe + (dir ? '/' : ''));
        return;
      }
      const segs = name.split('/');
      if (segs.some(s => s === '.' || s === '..')) { warn(i, `Line ${i + 1}: "${orig}" contains "." or ".." as a folder name. Skipped.`, 'Use real folder names only, like "src/utils/".'); return; }
      if (segs[0] === '.git') { warn(i, `Line ${i + 1}: ".git" can't be pushed. Skipped.`, 'GitHub makes this folder itself. Delete this line.', ''); return; }
      if (name !== orig) warn(i, `Line ${i + 1}: "${orig}" was cleaned up (${notes.join('; ')}).`, `Now read as "${name}".`, prefix + name + (dir ? '/' : ''));
      rows.push({ name, dir, L, i, prefix });
    });

    const unit = pickUnit(rows.map(r => r.L));
    rows.forEach(r => (r.d0 = Math.round(r.L / unit)));
    const min = rows.length ? Math.min(...rows.map(r => r.d0)) : 0;
    const roots = [], stack = []; let prev = null;

    for (const r of rows) {
      r.depth = r.d0 - min;
      if (r.L > 0 && r.L % unit) {
        const ws = /^\s*$/.test(r.prefix);
        warn(r.i, `Line ${r.i + 1}: indent is ${r.L} spaces, but the rest use steps of ${unit}.`, `Use ${r.d0 * unit} spaces here (or tap Indent / Outdent).`, ws ? ' '.repeat(r.d0 * unit) + r.name + (r.dir ? '/' : '') : null);
      }
      if (prev && r.depth > prev.depth + 1) warn(r.i, `Line ${r.i + 1}: "${r.name}" is ${r.depth - prev.depth} levels deeper than the line above.`, 'Indent it just one level, or add the missing parent folder above it.');
      prev = r;

      const node = { name: r.name, type: r.dir ? 'folder' : 'file', children: [], line: r.i };
      while (stack.length && stack[stack.length - 1].depth >= r.depth) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].node : null;
      if (parent) {
        if (parent.type === 'file' && FILE_LIKE.test(parent.name) && !parent.warned) {
          parent.warned = true;
          warn(parent.line, `Line ${parent.line + 1}: "${parent.name}" looks like a file, but lines below are indented under it, so it became a folder.`, `If it is a file, outdent the lines below it. If it really is a folder, write "${parent.name}/".`);
        }
        parent.type = 'folder';
      }
      const list = parent ? parent.children : roots;
      const dup = list.find(n => n.name === node.name);
      if (dup) {
        if (dup.type === 'folder' && node.type === 'folder') { stack.push({ node: dup, depth: r.depth }); continue; }
        warn(r.i, `Line ${r.i + 1}: "${node.name}" appears twice in the same folder. The second one was skipped.`, 'Rename or delete one of them.'); continue;
      }
      list.push(node);
      stack.push({ node, depth: r.depth });
    }
    if (!rows.length && text.trim()) warnings.push({ line: 0, msg: "Couldn't find any file or folder names.", how: 'Write one name per line. End folders with "/" and indent items that go inside.', fix: null });
    warnings.sort((a, b) => a.line - b.line);
    return { roots, warnings };
  }

  function applyFixes(text, warnings) {
    const map = new Map();
    warnings.forEach(w => { if (w.fix !== null && !map.has(w.line)) map.set(w.line, w.fix); });
    return text.split('\n').map((l, i) => (map.has(i) ? map.get(i) : l)).filter((l, i) => !(map.has(i) && map.get(i) === '')).join('\n');
  }

  // nested nodes -> pretty tree text (├── └── │)
  function toText(roots) {
    const out = [];
    (function walk(list, pre) {
      list.forEach((n, i) => {
        const last = i === list.length - 1;
        out.push(pre + (last ? '└── ' : '├── ') + n.name + (n.type === 'folder' ? '/' : ''));
        if (n.children.length) walk(n.children, pre + (last ? '    ' : '│   '));
      });
    })(roots.length === 1 && roots[0].type === 'folder' ? (out.push(roots[0].name + '/'), roots[0].children) : roots, '');
    return out.join('\n');
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

  // If every file sits in one top folder, drop it (repo root = project)
  function stripRoot(files) {
    if (!files.length) return files;
    const first = files[0].path.split('/')[0];
    if (files.every(f => f.path.includes('/') && f.path.split('/')[0] === first))
      return files.map(f => ({ ...f, path: f.path.slice(first.length + 1) }));
    return files;
  }

  g.TF = Object.assign(g.TF || {}, { parseTree, flatten, fromPaths, count, stripRoot, applyFixes, toText, prefixLen });
})(window);
