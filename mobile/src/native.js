'use strict';
/* Android shell glue. Does nothing in a normal browser; inside the Capacitor app it adds:
   - share-sheet saving for backups and CSV exports
   - the hardware back button
   - a "rest is over" notification when the app is in the background */
(function () {
  const C = window.Capacitor, P = C && C.Plugins;
  if (!P || !P.Filesystem || !P.Share) return;
  document.documentElement.classList.add('native');

  const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  window.HadidSaveFile = async (name, data) => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const f = await P.Filesystem.writeFile({ path: name, data: toB64(bytes), directory: 'CACHE' });
    await P.Share.share({ title: name, dialogTitle: 'Save or send your Hadid file', files: [f.uri] });
  };

  if (P.App) {
    P.App.addListener('backButton', () => {
      const m = document.querySelector('#modal.open');
      if (m) { closeModal(); m.classList.remove('pr'); return; }
      const h = location.hash.replace(/^#/, '') || '/home';
      if (h !== '/home' && h !== '/') { go('/home'); return; }
      P.App.exitApp();
    });
  }

  // Rest timer: schedule a notification only while the app is backgrounded, so it never doubles the in-app beep.
  const N = P.LocalNotifications, REST_ID = 4201;
  let rest = { end: 0, label: 'Rest' }, asked = false;
  if (N) {
    window.addEventListener('hadid:rest', async e => {
      rest = e.detail;
      if (!asked) { asked = true; try { await N.requestPermissions(); await N.createChannel({ id: 'rest', name: 'Rest timer', importance: 4, vibration: true }); } catch (_) { /* notifications are optional */ } }
    });
    window.addEventListener('hadid:rest-stop', () => { rest = { end: 0, label: 'Rest' }; try { N.cancel({ notifications: [{ id: REST_ID }] }); } catch (_) { /* ignore */ } });
    if (P.App) P.App.addListener('appStateChange', async ({ isActive }) => {
      try {
        if (!isActive && rest.end > Date.now()) {
          await N.schedule({ notifications: [{ id: REST_ID, title: 'Rest is over', body: `${rest.label}: back to the bar.`, channelId: 'rest', schedule: { at: new Date(rest.end), allowWhileIdle: true } }] });
        } else if (isActive) await N.cancel({ notifications: [{ id: REST_ID }] });
      } catch (_) { /* ignore */ }
    });
  }
})();
