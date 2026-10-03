/* Orlixa — Cordova shell
 *
 * Structure (top to bottom):
 *   1. Config   – defaults merged with window.ORLIXA_CONFIG, then validated
 *   2. Store    – state + the phase state machine (the only way to change phase)
 *   3. View     – the only code that touches the DOM
 *   4. Services – network, permissions, native chrome
 *   5. Loader   – connection flow (direct / iframe)
 *   6. Events   – listeners wired to the above
 *   7. Boot
 *
 * Phases: boot -> permissions -> connecting -> ready
 *                                  connecting/ready <-> error
 */
(function () {
  'use strict';

  /* ============================ 1. CONFIG ============================ */
  var DEFAULTS = {
    appUrl: 'https://orlixa.art/app/',
    loadMode: 'direct',
    timeoutMs: 15000,
    revealDelayMs: 150,
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
    statusBarColor: '#0b0b14',
    messages: {
      offline:     'You appear to be offline. Check your connection and try again.',
      timeout:     'Orlixa took too long to respond. Please try again.',
      unreachable: 'Could not reach Orlixa. Check your connection and try again.'
    }
  };

  var Config = (function () {
    var user = window.ORLIXA_CONFIG || {};
    var cfg = {};
    function warn(key, why) { if (window.console) console.warn('[Orlixa config] "' + key + '" ' + why + ' - using default'); }

    Object.keys(DEFAULTS).forEach(function (k) { cfg[k] = DEFAULTS[k]; });

    if (user.appUrl !== undefined) {
      try {
        var u = new URL(user.appUrl);
        if (u.protocol === 'https:') cfg.appUrl = u.href; else warn('appUrl', 'must be https');
      } catch (e) { warn('appUrl', 'is not a valid URL'); }
    }
    if (user.loadMode !== undefined) {
      if (user.loadMode === 'direct' || user.loadMode === 'iframe') cfg.loadMode = user.loadMode;
      else warn('loadMode', 'must be "direct" or "iframe"');
    }
    ['timeoutMs', 'revealDelayMs'].forEach(function (k) {
      if (user[k] === undefined) return;
      if (typeof user[k] === 'number' && isFinite(user[k]) && user[k] >= 0) cfg[k] = user[k];
      else warn(k, 'must be a non-negative number');
    });
    if (user.permissions !== undefined) {
      if (Array.isArray(user.permissions) && user.permissions.every(function (p) { return typeof p === 'string'; })) cfg.permissions = user.permissions.slice();
      else warn('permissions', 'must be an array of strings');
    }
    if (typeof user.statusBarColor === 'string' && /^#[0-9a-f]{6}$/i.test(user.statusBarColor)) cfg.statusBarColor = user.statusBarColor;
    else if (user.statusBarColor !== undefined) warn('statusBarColor', 'must look like #rrggbb');
    if (user.messages && typeof user.messages === 'object') {
      cfg.messages = {};
      Object.keys(DEFAULTS.messages).forEach(function (k) {
        cfg.messages[k] = typeof user.messages[k] === 'string' ? user.messages[k] : DEFAULTS.messages[k];
      });
    }

    cfg.origin = new URL(cfg.appUrl).origin;
    return Object.freeze(cfg);
  })();

  /* ============================ 2. STORE ============================= */
  var PHASE = { BOOT: 'boot', PERMISSIONS: 'permissions', CONNECTING: 'connecting', READY: 'ready', ERROR: 'error' };
  var ALLOWED = {};
  ALLOWED[PHASE.BOOT]        = [PHASE.PERMISSIONS];
  ALLOWED[PHASE.PERMISSIONS] = [PHASE.CONNECTING];
  ALLOWED[PHASE.CONNECTING]  = [PHASE.READY, PHASE.ERROR];
  ALLOWED[PHASE.READY]       = [PHASE.CONNECTING, PHASE.ERROR];
  ALLOWED[PHASE.ERROR]       = [PHASE.CONNECTING];

  var Store = {
    state: {
      phase: PHASE.BOOT,
      attempt: 0,
      hasLoadedOnce: false,
      errorReason: null,
      permissions: { supported: false, granted: null },
      backPressedOnce: false
    },
    timers: {},
    listeners: [],

    subscribe: function (fn) { Store.listeners.push(fn); },

    setTimer: function (name, fn, ms) { Store.clearTimer(name); Store.timers[name] = setTimeout(fn, ms); },
    clearTimer: function (name) { clearTimeout(Store.timers[name]); delete Store.timers[name]; },
    clearTimers: function () { Object.keys(Store.timers).forEach(Store.clearTimer); },

    /** The ONLY way to change phase. Returns false if the move is not allowed. */
    transition: function (next, info) {
      var s = Store.state;
      if (ALLOWED[s.phase].indexOf(next) === -1) return false;
      Store.clearTimers();
      s.phase = next;
      s.errorReason = next === PHASE.ERROR ? ((info && info.reason) || 'unreachable') : null;
      if (next === PHASE.READY) s.hasLoadedOnce = true;
      Store.listeners.forEach(function (fn) { fn(s); });
      return true;
    }
  };

  /* ============================= 3. VIEW ============================= */
  var View = {
    el: {
      frame: document.getElementById('web-frame'),
      loading: document.getElementById('loading-screen'),
      error: document.getElementById('error-screen'),
      errorText: document.querySelector('#error-screen p'),
      retry: document.getElementById('retry-btn')
    },
    render: function (s) {
      var loading = s.phase === PHASE.BOOT || s.phase === PHASE.PERMISSIONS || s.phase === PHASE.CONNECTING;
      View.el.loading.classList.toggle('hidden', !loading);
      View.el.error.classList.toggle('hidden', s.phase !== PHASE.ERROR);
      View.el.frame.classList.toggle('ready', s.phase === PHASE.READY);
      if (s.phase === PHASE.ERROR && View.el.errorText) {
        View.el.errorText.textContent = Config.messages[s.errorReason] || Config.messages.unreachable;
      }
    }
  };
  Store.subscribe(View.render);

  /* =========================== 4. SERVICES =========================== */
  var Net = {
    isOnline: function () {
      var c = navigator.connection;
      if (c && typeof c.type !== 'undefined') return c.type !== 'none';
      return navigator.onLine !== false;
    },
    /** Resolves if the server answers at all (opaque response is fine). */
    checkReachable: function (ms) {
      return new Promise(function (resolve, reject) {
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var t = setTimeout(function () { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, ms);
        fetch(Config.appUrl, { mode: 'no-cors', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
          .then(function () { clearTimeout(t); resolve(); })
          .catch(function (e) { clearTimeout(t); reject(e); });
      });
    }
  };

  var Permissions = {
    /** Always resolves; needs cordova-plugin-android-permissions. */
    request: function () {
      return new Promise(function (resolve) {
        var p = window.cordova && cordova.plugins && cordova.plugins.permissions;
        if (!p || !Config.permissions.length) return resolve({ supported: !!p, granted: null });
        p.requestPermissions(
          Config.permissions,
          function (s) { resolve({ supported: true, granted: !!(s && s.hasPermission) }); },
          function () { resolve({ supported: true, granted: false }); }
        );
      });
    }
  };

  var Native = {
    setupChrome: function () {
      if (window.StatusBar) {
        StatusBar.styleLightContent();
        StatusBar.backgroundColorByHexString(Config.statusBarColor);
      }
      if (navigator.splashscreen) navigator.splashscreen.hide();
    },
    openExternal: function (url) {
      if (window.cordova && cordova.InAppBrowser) cordova.InAppBrowser.open(url, '_system');
      else window.open(url, '_system');
    },
    /** Iframe mode only; in direct mode Cordova's default back handling applies. */
    setupBackButton: function () {
      if (Config.loadMode !== 'iframe') return;
      document.addEventListener('backbutton', function (e) {
        e.preventDefault();
        var s = Store.state;
        if (!navigator.app) return;
        if (s.backPressedOnce) return navigator.app.exitApp();
        s.backPressedOnce = true;
        setTimeout(function () { s.backPressedOnce = false; }, 2000);
      }, false);
    }
  };

  /* ============================ 5. LOADER ============================ */
  var Loader = {
    connect: function () {
      var s = Store.state;
      if (!Store.transition(PHASE.CONNECTING)) return;     // ignored if not allowed
      var attempt = ++s.attempt;
      var stale = function () { return attempt !== s.attempt || s.phase !== PHASE.CONNECTING; };

      if (!Net.isOnline()) { Store.transition(PHASE.ERROR, { reason: 'offline' }); return; }

      Store.setTimer('connect-timeout', function () {
        if (!stale()) Store.transition(PHASE.ERROR, { reason: 'timeout' });
      }, Config.timeoutMs);

      if (Config.loadMode === 'iframe') {
        View.el.frame.src = Config.appUrl;                 // frame 'load' listener finishes
        return;
      }
      Net.checkReachable(Math.max(Config.timeoutMs - 1000, 1000)).then(function () {
        if (stale()) return;
        window.location.replace(Config.appUrl);            // script ends here in direct mode
      }, function (e) {
        if (stale()) return;
        Store.transition(PHASE.ERROR, { reason: e && e.message === 'timeout' ? 'timeout' : 'unreachable' });
      });
    }
  };

  /* ============================ 6. EVENTS ============================ */
  function bindEvents() {
    var frame = View.el.frame;

    frame.addEventListener('load', function () {
      if (Config.loadMode !== 'iframe' || frame.src === 'about:blank') return;
      setTimeout(function () { Store.transition(PHASE.READY); }, Config.revealDelayMs);
    });
    frame.addEventListener('error', function () { Store.transition(PHASE.ERROR, { reason: 'unreachable' }); });

    View.el.retry.addEventListener('click', Loader.connect);

    window.addEventListener('offline', function () {
      var s = Store.state;
      if (s.phase === PHASE.CONNECTING && !s.hasLoadedOnce) Store.transition(PHASE.ERROR, { reason: 'offline' });
    });
    window.addEventListener('online', function () {
      var s = Store.state;
      if (s.phase === PHASE.ERROR && !s.hasLoadedOnce) Loader.connect();
    });

    // Embedded page asks to open a URL in the system browser (iframe mode).
    window.addEventListener('message', function (event) {
      var d = event.data, url;
      if (event.origin !== Config.origin) return;
      if (!d || d.type !== 'openExternal' || typeof d.url !== 'string') return;
      try { url = new URL(d.url); } catch (e) { return; }
      if (url.protocol !== 'https:') return;
      Native.openExternal(url.href);
    });
  }

  /* ============================== 7. BOOT ============================ */
  function init() {
    Native.setupChrome();
    Native.setupBackButton();
    bindEvents();
    View.render(Store.state);
    Store.transition(PHASE.PERMISSIONS);
    Permissions.request().then(function (result) {
      Store.state.permissions = result;     // informational; never blocks loading
      Loader.connect();
    });
  }

  if (window.cordova) document.addEventListener('deviceready', init, false);
  else document.addEventListener('DOMContentLoaded', init, false);
})();
