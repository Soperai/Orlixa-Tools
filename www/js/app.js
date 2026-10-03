(function () {
  'use strict';

  // The site this app wraps. Change here if the path ever moves.
  var APP_URL = 'https://orlixa.art/app/';
  var LOAD_TIMEOUT_MS = 15000;

  var frame = document.getElementById('web-frame');
  var loadingScreen = document.getElementById('loading-screen');
  var errorScreen = document.getElementById('error-screen');
  var retryBtn = document.getElementById('retry-btn');

  var loadTimer = null;
  var hasLoadedOnce = false;
  var backButtonPressedOnce = false;

  function isOnline() {
    if (window.navigator && navigator.connection && typeof navigator.connection.type !== 'undefined') {
      return navigator.connection.type !== 'none';
    }
    return navigator.onLine !== false;
  }

  function showLoading() {
    errorScreen.classList.add('hidden');
    loadingScreen.classList.remove('hidden');
  }

  function showError() {
    clearTimeout(loadTimer);
    loadingScreen.classList.add('hidden');
    errorScreen.classList.remove('hidden');
    frame.classList.remove('ready');
  }

  function showFrame() {
    clearTimeout(loadTimer);
    hasLoadedOnce = true;
    errorScreen.classList.add('hidden');
    frame.classList.add('ready');
    // Small delay so the fade-in feels intentional rather than a flash.
    setTimeout(function () {
      loadingScreen.classList.add('hidden');
    }, 150);
  }

  function loadApp() {
    if (!isOnline()) {
      showError();
      return;
    }
    showLoading();
    frame.classList.remove('ready');

    clearTimeout(loadTimer);
    loadTimer = setTimeout(function () {
      showError();
    }, LOAD_TIMEOUT_MS);

    // FIX: open the site as the top-level page instead of inside an iframe.
    // Iframes were blocked by the server's X-Frame-Options header and break
    // session cookies. First do a quick reachability check so we can still
    // show our own error screen if the server is down.
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var abortTimer = setTimeout(function () { if (ctrl) ctrl.abort(); }, LOAD_TIMEOUT_MS - 1000);
    fetch(APP_URL, { mode: 'no-cors', cache: 'no-store', signal: ctrl ? ctrl.signal : undefined })
      .then(function () {
        clearTimeout(abortTimer);
        clearTimeout(loadTimer);
        window.location.replace(APP_URL);
      })
      .catch(function () {
        clearTimeout(abortTimer);
        showError();
      });
  }

  frame.addEventListener('load', function () {
    // about:blank fires 'load' too; ignore it.
    if (frame.src === 'about:blank') return;
    showFrame();
  });

  frame.addEventListener('error', showError);

  retryBtn.addEventListener('click', loadApp);

  window.addEventListener('offline', function () {
    if (!hasLoadedOnce) showError();
  });

  // The embedded page (orlixa.art) posts this message when a feature like
  // voice recording can't get microphone access inside the app's WebView
  // (e.g. RECORD_AUDIO not yet granted). Open that URL in the system
  // browser instead, where mic permission works normally.
  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'openExternal' || !event.data.url) return;
    if (window.cordova && window.cordova.InAppBrowser) {
      window.cordova.InAppBrowser.open(event.data.url, '_system');
    } else {
      window.open(event.data.url, '_system');
    }
  });

  window.addEventListener('online', function () {
    if (!hasLoadedOnce) loadApp();
  });

  // Ask Android for camera + microphone BEFORE the site tries getUserMedia().
  // Needs: cordova plugin add cordova-plugin-android-permissions
  // and <uses-permission android:name="android.permission.CAMERA"/> in config.xml
  function requestMediaPermissions(done) {
    var perms = window.cordova && cordova.plugins && cordova.plugins.permissions;
    if (!perms) { done(); return; }
    var list = ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'];
    perms.requestPermissions(list, function () { done(); }, function () { done(); });
  }

  function initApp() {
    requestMediaPermissions(loadApp);

    // Android hardware back button: we can't reach into the cross-origin
    // iframe's history, so use a "press back again to exit" pattern.
    document.addEventListener('backbutton', function (e) {
      e.preventDefault();
      if (!window.navigator.app) return;

      if (backButtonPressedOnce) {
        navigator.app.exitApp();
        return;
      }
      backButtonPressedOnce = true;
      setTimeout(function () { backButtonPressedOnce = false; }, 2000);
    }, false);

    // Keep the status bar readable against the dark theme.
    if (window.StatusBar) {
      StatusBar.styleLightContent();
      StatusBar.backgroundColorByHexString('#0b0b14');
    }

    if (window.navigator && navigator.splashscreen) {
      // Hide the native splash once our own loading screen has taken over.
      navigator.splashscreen.hide();
    }
  }

  if (window.cordova) {
    document.addEventListener('deviceready', initApp, false);
  } else {
    // Browser preview (no Cordova) - just run directly.
    document.addEventListener('DOMContentLoaded', initApp, false);
  }
})();

