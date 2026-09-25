// A stand-in for Firebase that keeps the database in localStorage. Open the
// site with ?local in several tabs of the same browser to try a game
// without setting up Firebase. Tabs see each other's writes through the
// "storage" event.

const KEY = 'rr-local-db';
const TS = { '.sv': 'timestamp' };

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function save(tree) {
  localStorage.setItem(KEY, JSON.stringify(tree));
}

function parts(path) {
  return path.split('/').filter(Boolean);
}

function getAt(tree, path) {
  let node = tree;
  for (const p of parts(path)) {
    if (node === null || typeof node !== 'object' || !(p in node)) {
      return null;
    }
    node = node[p];
  }
  return node === undefined ? null : node;
}

// Replaces timestamp sentinels and drops nulls, like Firebase does.
function resolve(value) {
  if (value && typeof value === 'object') {
    if (value['.sv'] === 'timestamp') {
      return Date.now();
    }
    if (Array.isArray(value)) {
      return value.map(resolve);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const r = resolve(v);
      if (r !== null && r !== undefined) {
        out[k] = r;
      }
    }
    return Object.keys(out).length ? out : null;
  }
  return value === undefined ? null : value;
}

function setAt(tree, path, value) {
  const ps = parts(path);
  const v = resolve(value);
  let node = tree;
  for (let i = 0; i < ps.length - 1; i++) {
    if (node[ps[i]] === null || typeof node[ps[i]] !== 'object') {
      node[ps[i]] = {};
    }
    node = node[ps[i]];
  }
  const last = ps[ps.length - 1];
  if (v === null) {
    delete node[last];
  } else {
    node[last] = v;
  }
}

let pushCounter = 0;
function pushKey() {
  pushCounter++;
  return 'k' + Date.now().toString(36).padStart(9, '0') + pushCounter.toString(36).padStart(4, '0') +
    Math.random().toString(36).slice(2, 6);
}

export function createBackend() {
  const listeners = new Set();

  function notify() {
    const tree = load();
    for (const l of listeners) {
      l.cb(getAt(tree, l.path));
    }
  }

  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      notify();
    }
  });

  function write(mutator) {
    const tree = load();
    mutator(tree);
    save(tree);
    // Other tabs get the storage event. This tab has to notify itself.
    queueMicrotask(notify);
  }

  return {
    name: 'local',
    TS,
    now: () => Date.now(),
    subscribe(path, cb) {
      const l = { path, cb };
      listeners.add(l);
      queueMicrotask(() => cb(getAt(load(), path)));
      return () => listeners.delete(l);
    },
    async set(path, value) {
      write((tree) => setAt(tree, path, value));
    },
    async update(path, obj) {
      write((tree) => {
        for (const [k, v] of Object.entries(obj)) {
          setAt(tree, `${path}/${k}`, v);
        }
      });
    },
    async push(path, value) {
      const key = pushKey();
      write((tree) => setAt(tree, `${path}/${key}`, value));
      return { key };
    },
    async transaction(path, fn) {
      let committed = false;
      write((tree) => {
        const next = fn(getAt(tree, path));
        if (next !== undefined) {
          setAt(tree, path, next);
          committed = true;
        }
      });
      return committed;
    },
    trackOnline(path) {
      this.set(path, true);
      window.addEventListener('pagehide', () => {
        const tree = load();
        setAt(tree, path, false);
        save(tree);
      });
    },
  };
}
