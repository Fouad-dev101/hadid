'use strict';
/* Starts the in-app database and exposes it as window.HadidLocal. Loaded before app.js on the phone. */
(function () {
  const demo = /[?&]demo=1/.test(location.search) || (function () { try { return localStorage.getItem('hadid-demo') === '1'; } catch (e) { return false; } })();
  const DB_NAME = demo ? 'hadid-demo' : 'hadid';

  const openIdb = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const load = async () => {
    const db = await openIdb();
    return new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get('db');
      q.onsuccess = () => { db.close(); res(q.result ? new Uint8Array(q.result) : null); };
      q.onerror = () => rej(q.error);
    });
  };
  const save = async bytes => {
    const db = await openIdb();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(bytes, 'db');
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('storage write aborted'));
    });
  };
  const b64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

  const ready = (async () => {
    const SQL = await initSqlJs({ wasmBinary: b64(window.HADID_WASM_B64) });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const store = HadidStoreLib.createStore({ SQL, load, save, demo, saveFile: (...a) => window.HadidSaveFile(...a) });
    await store.ready;
    return store;
  })();

  window.HadidLocal = {
    ready,
    handle: async (m, p, b) => (await ready).handle(m, p, b),
    exportCSV: async () => (await ready).exportCSV(),
    exportDB: async () => (await ready).exportDB(),
    importDB: async bytes => (await ready).importDB(bytes),
  };
})();
