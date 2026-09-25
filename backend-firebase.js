// Thin wrapper around the Firebase Realtime Database. The rest of the app
// only talks to the small interface returned by createBackend().

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  push,
  runTransaction,
  serverTimestamp,
  onDisconnect,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js';

export function createBackend(config) {
  const app = initializeApp(config);
  const db = getDatabase(app);

  // Offset between this device's clock and the Firebase server clock.
  // All timers use server time so every player sees the same countdown.
  let offset = 0;
  onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    offset = snap.val() || 0;
  });

  return {
    name: 'firebase',
    TS: serverTimestamp(),
    now: () => Date.now() + offset,
    subscribe(path, cb) {
      return onValue(ref(db, path), (snap) => cb(snap.val()));
    },
    set: (path, value) => set(ref(db, path), value),
    update: (path, obj) => update(ref(db, path), obj),
    push: (path, value) => push(ref(db, path), value),
    async transaction(path, fn) {
      const res = await runTransaction(ref(db, path), fn);
      return res.committed;
    },
    // Sets `path` to true while connected and false when the connection drops.
    trackOnline(path) {
      onValue(ref(db, '.info/connected'), (snap) => {
        if (snap.val() === true) {
          onDisconnect(ref(db, path)).set(false);
          set(ref(db, path), true);
        }
      });
    },
  };
}
