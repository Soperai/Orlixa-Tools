/* Orlixa — Cordova shell
 *
 * Wraps https://orlixa.art/app/ with native splash, offline screen,
 * Android permission prompts and back-button handling.
 *
 * LOAD_MODE
 *   'direct' (recommended): after a reachability check the WebView navigates
 *            to the site as the top-level page. No X-Frame-Options problems,
 *            first-party cookies, camera/mic prompts work natively.
 *            NOTE: once it navigates, this script is gone (different origin),
 *            so later offline errors are handled by Android, not by this file.
 *   'iframe': keeps the site inside this shell. Requires the server to allow
 *            framing (CSP frame-ancestors https://localhost) and
 *            SameSite=None; Secure session cookies.
 */
(function () {
  'use strict';

  // ---------- Config ----------
  var APP_URL = 'https://orlixa.art/app/';
  var APP_ORIGIN = new URL(APP_URL).origin;
  var LOAD_MODE = 'direct';            // 'direct' | 'iframe'
  var LOAD_TIMEOUT_MS = 15000;
  var ANDROID_PERMISSIONS = [
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO'
  ];

  // ---------- DOM ----------
  var frame = document.getElementById('web-frame');
  var loadingScreen = document.getElementById('loading-screen');
  var errorScreen = document.getElementById('error-screen');
  var retryBtn = document.getElementById('retry-btn');

  var state = { loadTimer: null, hasLoadedOnce: false, backPressedOnce: false };

  // ---------- UI states ----------
  var ui = {
    loading: function () {
      errorScreen.classList.add('hidden');
      loadingScreen.classList.remove('hidden');
      frame.classList.remove('ready');
    },
    error: function () {
      clearTimeout(state.loadTimer);
      loadingScreen.classList.add('hidden');
      errorScreen.classList.remove('hidden');
      frame.classList.remove('ready');
    },
    ready: function () {
      clearTimeout(state.loadTimer);
      state.hasLoadedOnce = true;
      errorScreen.classList.add('hidden');
      frame.classList.add('ready');
      setTimeout(function () { loadingScreen.classList.add('hidden'); }, 150);
    }
  };

  // ---------- Network ----------
  function isOnline() {
    var c = navigator.connection;
    if (c && typeof c.type !== 'undefined') return c.type !== 'none';
    return navigator.onLine !== false;
  }

  // Resolves if the server answers at all (opaque response is fine).
  function checkReachable() {
    return new Promise(function (resolve, reject) {
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var t = setTimeout(function () { if (ctrl) ctrl.abort(); reject(new Error('timeout')); }, LOAD_TIMEOUT_MS - 1000);
      fetch(APP_URL, { mode: 'no-cors', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
        .then(function () { clearTimeout(t); resolve(); })
        .catch(function (e) { clearTimeout(t); reject(e); });
    });
  }

  // ---------- Android permissions ----------
  // Needs cordova-plugin-android-permissions. Always resolves (never blocks
  // loading); the site shows its own message if the user denies.
  var permissions = {
    plugin: function () {
      return window.cordova && cordova.plugins && cordova.plugins.permissions;
    },
    request: function () {
      return new Promise(function (resolve) {
        var p = permissions.plugin();
        if (!p) return resolve({ supported: false });
        p.requestPermissions(
          ANDROID_PERMISSIONS,
          function (status) { resolve({ supported: true, granted: !!(status && status.hasPermission) }); },
          function () { resolve({ supported: true, granted: false }); }
        );
      });
    }
  };

  // ---------- Loaders ----------
  function loadDirect() {
    checkReachable().then(function () {
      clearTimeout(state.loadTimer);
      window.location.replace(APP_URL);
    }, ui.error);
  }

  function loadIframe() {
    frame.src = APP_URL;   // 'load' / timeout handlers below finish the job
  }

  function loadApp() {
    if (!isOnline()) return ui.error();
    ui.loading();
    clearTimeout(state.loadTimer);
    state.loadTimer = setTimeout(ui.error, LOAD_TIMEOUT_MS);
    if (LOAD_MODE === 'iframe') loadIframe(); else loadDirect();
  }

  // ---------- Iframe-mode events ----------
  frame.addEventListener('load', function () {
    if (LOAD_MODE !== 'iframe' || frame.src === 'about:blank') return;
    ui.ready();
  });
  frame.addEventListener('error', ui.error);

  // Embedded page asks us to open a URL in the system browser (iframe mode).
  // Only accept messages from the app's own origin and https URLs.
  window.addEventListener('message', function (event) {
    var d = event.data;
    if (event.origin !== APP_ORIGIN) return;
    if (!d || d.type !== 'openExternal' || typeof d.url !== 'string') return;
    var url;
    try { url = new URL(d.url); } catch (e) { return; }
    if (url.protocol !== 'https:') return;
    if (window.cordova && cordova.InAppBrowser) cordova.InAppBrowser.open(url.href, '_system');
    else window.open(url.href, '_system');
  });

  // ---------- Misc listeners ----------
  retryBtn.addEventListener('click', loadApp);
  window.addEventListener('offline', function () { if (!state.hasLoadedOnce) ui.error(); });
  window.addEventListener('online', function () { if (!state.hasLoadedOnce) loadApp(); });

  // Iframe mode only: we can't reach into the cross-origin frame's history,
  // so use "press back again to exit". In direct mode Cordova's default
  // back handling (WebView history, then exit) is used.
  function setupBackButton() {
    if (LOAD_MODE !== 'iframe') return;
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
    // Ask for camera/mic first, then load regardless of the answer.
    permissions.request().then(loadApp);
  }

  if (window.cordova) document.addEventListener('deviceready', init, false);
  else document.addEventListener('DOMContentLoaded', init, false);
})();
