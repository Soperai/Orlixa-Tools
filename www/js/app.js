/* Orlixa — Cordova shell (state-machine version)
 *
 * Phases:  BOOT -> PERMISSIONS -> CONNECTING -> READY
 *                                      |  ^         |
 *                                      v  |         v
 *                                     ERROR <-------+
 *
 * All UI is derived from `state.phase` in render(); nothing else touches
 * the DOM classes. Every async step carries an `attempt` id so stale
 * results (old timers, late fetches, retries) are ignored.
 *
 * LOAD_MODE 'direct' (recommended): navigate the WebView to the site once it
 *   is reachable (this script is replaced by the site after that).
 * LOAD_MODE 'iframe': keep the site in an iframe (server must allow framing).
 */
(function () {
  'use strict';

  // ---------- Config ----------
  var CONFIG = {
    appUrl: 'https://orlixa.art/app/',
    loadMode: 'direct',                 // 'direct' | 'iframe'
    timeoutMs: 15000,
    permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO']
  };
  var APP_ORIGIN = new URL(CONFIG.appUrl).origin;

  var PHASE = { BOOT: 'boot', PERMISSIONS: 'permissions', CONNECTING: 'connecting', READY: 'ready', ERROR: 'error' };
  var ALLOWED = {};
  ALLOWED[PHASE.BOOT]        = [PHASE.PERMISSIONS];
  ALLOWED[PHASE.PERMISSIONS] = [PHASE.CONNECTING];
  ALLOWED[PHASE.CONNECTING]  = [PHASE.READY, PHASE.ERROR];
  ALLOWED[PHASE.READY]       = [PHASE.CONNECTING, PHASE.ERROR];
  ALLOWED[PHASE.ERROR]       = [PHASE.CONNECTING];

  var ERROR_TEXT = {
    offline:     'You appear to be offline. Check your connection and try again.',
    timeout:     'Orlixa took too long to respond. Please try again.',
    unreachable: 'Could not reach Orlixa. Check your connection and try again.'
  };

  // ---------- State ----------
  var state = {
    phase: PHASE.BOOT,
    attempt: 0,               // increments on every connection attempt
    hasLoadedOnce: false,
    errorReason: null,
    permissions: { supported: false, granted: null },
    backPressedOnce: false
  };

  // ---------- DOM ----------
  var el = {
    frame: document.getElementById('web-frame'),
    loading: document.getElementById('loading-screen'),
    error: document.getElementById('error-screen'),
    errorText: document.querySelector('#error-screen p'),
    retry: document.getElementById('retry-btn')
  };

  // ---------- Timers (named, cleared on every transition) ----------
  var timers = {
    map: {},
    set: function (name, fn, ms) { timers.clear(name); timers.map[name] = setTimeout(fn, ms); },
    clear: function (name) { clearTimeout(timers.map[name]); delete timers.map[name]; },
    clearAll: function () { Object.keys(timers.map).forEach(timers.clear); }
  };

  // ---------- Rendering: the ONLY place that touches UI classes ----------
  function render() {
    var p = state.phase;
    var showLoading = p === PHASE.BOOT || p === PHASE.PERMISSIONS || p === PHASE.CONNECTING;
    el.loading.classList.toggle('hidden', !showLoading);
    el.error.classList.toggle('hidden', p !== PHASE.ERROR);
    el.frame.classList.toggle('ready', p === PHASE.READY);
    if (p === PHASE.ERROR && el.errorText) {
      el.errorText.textContent = ERROR_TEXT[state.errorReason] || ERROR_TEXT.unreachable;
    }
  }

  // ---------- The ONLY way to change phase ----------
  function transition(next, info) {
    if (ALLOWED[state.phase].indexOf(next) === -1) return false;   // illegal move: ignore
    timers.clearAll();
    state.phase = next;
    state.errorReason = next === PHASE.ERROR ? ((info && info.reason) || 'unreachable') : null;
    if (next === PHASE.READY) state.hasLoadedOnce = true;
    render();
    return true;
  }

  // ---------- Capabilities ----------
  function isOnline() {
    var c = navigator.connection;
    if (c && typeof c.type !== 'undefined') return c.type !== 'none';
    return navigator.onLine !== false;
  }

  function requestPermissions() {
    return new Promise(function (resolve) {
      var p = window.cordova && cordova.plugins && cordova.plugins.permissions;
      if (!p) return resolve({ supported: false, granted: null });
      p.requestPermissions(
        CONFIG.permissions,
        function (s) { resolve({ supported: true, granted: !!(s && s.hasPermission) }); },
        function () { resolve({ supported: true, granted: false }); }
      );
    });
  }

  function checkReachable(ms) {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var t = setTimeout(function () { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, ms);
      fetch(CONFIG.appUrl, { mode: 'no-cors', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function () { clearTimeout(t); resolve(); })
        .catch(function (e) { clearTimeout(t); reject(e); });
    });
  }

  // ---------- Connection flow ----------
  function connect() {
    if (!transition(PHASE.CONNECTING)) return;      // ignored if not allowed (e.g. double tap)
    var attempt = ++state.attempt;
    var stale = function () { return attempt !== state.attempt || state.phase !== PHASE.CONNECTING; };
    if (!isOnline()) return transition(PHASE.ERROR, { reason: 'offline' });

    timers.set('connect-timeout', function () {
      if (!stale()) transition(PHASE.ERROR, { reason: 'timeout' });
    }, CONFIG.timeoutMs);

    if (CONFIG.loadMode === 'iframe') {
      el.frame.src = CONFIG.appUrl;            // handled by the frame 'load' listener
      return;
    }
    checkReachable(CONFIG.timeoutMs - 1000).then(function () {
      if (stale()) return;
      window.location.replace(CONFIG.appUrl);  // script ends here in direct mode
    }, function (e) {
      if (stale()) return;
      transition(PHASE.ERROR, { reason: e && e.message === 'timeout' ? 'timeout' : 'unreachable' });
    });
  }

  // ---------- Events ----------
  el.frame.addEventListener('load', function () {
    if (CONFIG.loadMode !== 'iframe' || el.frame.src === 'about:blank') return;
    // 150 ms keeps the fade-in from flashing
    setTimeout(function () { transition(PHASE.READY); }, 150);
  });
  el.frame.addEventListener('error', function () { transition(PHASE.ERROR, { reason: 'unreachable' }); });

  el.retry.addEventListener('click', connect);

  window.addEventListener('offline', function () {
    if (state.phase === PHASE.CONNECTING && !state.hasLoadedOnce) transition(PHASE.ERROR, { reason: 'offline' });
  });
  window.addEventListener('online', function () {
    if (state.phase === PHASE.ERROR && !state.hasLoadedOnce) connect();
  });

  // Embedded page asks to open a URL in the system browser (iframe mode).
  window.addEventListener('message', function (event) {
    var d = event.data, url;
    if (event.origin !== APP_ORIGIN) return;
    if (!d || d.type !== 'openExternal' || typeof d.url !== 'string') return;
    try { url = new URL(d.url); } catch (e) { return; }
    if (url.protocol !== 'https:') return;
    if (window.cordova && cordova.InAppBrowser) cordova.InAppBrowser.open(url.href, '_system');
    else window.open(url.href, '_system');
  });

  // Iframe mode only; in direct mode Cordova's default back handling applies.
  function setupBackButton() {
    if (CONFIG.loadMode !== 'iframe') return;
    document.addEventListener('backbutton', function (e) {
      e.preventDefault();
      if (!navigator.app) return;
      if (state.backPressedOnce) return navigator.app.exitApp();
      state.backPressedOnce = true;
      setTimeout(function () { state.backPressedOnce = false; }, 2000);
    }, false);
  }

  function setupChrome() {
    if (window.StatusBar) {
      StatusBar.styleLightContent();
      StatusBar.backgroundColorByHexString('#0b0b14');
    }
    if (navigator.splashscreen) navigator.splashscreen.hide();
  }

  // ---------- Boot ----------
  function init() {
    setupChrome();
    setupBackButton();
    render();
    transition(PHASE.PERMISSIONS);
    requestPermissions().then(function (result) {
      state.permissions = result;      // kept for debugging; never blocks loading
      connect();                       // PERMISSIONS -> CONNECTING
    });
  }

  if (window.cordova) document.addEventListener('deviceready', init, false);
  else document.addEventListener('DOMContentLoaded', init, false);
})();
