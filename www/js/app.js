(function () {
  'use strict';

  var cfg = window.ORLIXA_CONFIG || {};
  var APP_URL = cfg.appUrl || ('https:' + '//orlixa.art/app/');
  var LOAD_MODE = cfg.loadMode || 'direct';
  var LOAD_TIMEOUT_MS = cfg.timeoutMs || 15000;
  var REVEAL_DELAY_MS = typeof cfg.revealDelayMs === 'number' ? cfg.revealDelayMs : 150;

  var frame = document.getElementById('web-frame');
  var loadingScreen = document.getElementById('loading-screen');
  var errorScreen = document.getElementById('error-screen');
  var errorMsg = document.getElementById('error-msg');
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
    if (errorScreen) errorScreen.classList.add('hidden');
    if (loadingScreen) loadingScreen.classList.remove('hidden');
  }

  function showError(message) {
    clearTimeout(loadTimer);
    if (errorMsg && message) {
      errorMsg.textContent = message;
    }
    if (loadingScreen) loadingScreen.classList.add('hidden');
    if (errorScreen) errorScreen.classList.remove('hidden');
    if (frame) frame.classList.remove('ready');
  }

  function showFrame() {
    clearTimeout(loadTimer);
    hasLoadedOnce = true;
    if (errorScreen) errorScreen.classList.add('hidden');
    if (frame) frame.classList.add('ready');
    setTimeout(function () {
      if (loadingScreen) loadingScreen.classList.add('hidden');
    }, REVEAL_DELAY_MS);
  }

  function requestMediaPermissions(callback) {
    try {
      var P = window.cordova && cordova.plugins && (cordova.plugins.permissions || cordova.plugins.permission);
      if (!P || typeof P.requestPermissions !== 'function') {
        console.warn('Permissions plugin not available');
        if (callback) callback();
        return;
      }
      var perms = [
        P.CAMERA || 'android.permission.CAMERA',
        P.RECORD_AUDIO || 'android.permission.RECORD_AUDIO',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.READ_EXTERNAL_STORAGE'
      ];
      P.requestPermissions(
        perms,
        function (status) {
          console.log('Permissions result:', status);
          if (callback) callback();
        },
        function (err) {
          console.warn('Permissions request failed:', err);
          if (callback) callback();
        }
      );
    } catch (e) {
      console.warn('Permissions request error:', e);
      if (callback) callback();
    }
  }

  function loadApp() {
    if (!isOnline()) {
      var offlineMsg = (cfg.messages && cfg.messages.offline) ||
        'You appear to be offline. Check your connection and try again.';
      showError(offlineMsg);
      return;
    }

    showLoading();

    if (LOAD_MODE === 'direct') {
      window.location.replace(APP_URL);
      return;
    }

    if (frame) {
      frame.classList.remove('ready');
      clearTimeout(loadTimer);
      loadTimer = setTimeout(function () {
        var timeoutMsg = (cfg.messages && cfg.messages.timeout) ||
          'The site took too long to respond. Please try again.';
        showError(timeoutMsg);
      }, LOAD_TIMEOUT_MS);
      frame.src = APP_URL;
    }
  }

  if (frame) {
    frame.addEventListener('load', function () {
      if (frame.src === 'about:blank' || !frame.src) return;
      showFrame();
    });
    frame.addEventListener('error', function () {
      showError();
    });
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', loadApp);
  }

  window.addEventListener('offline', function () {
    if (!hasLoadedOnce) showError();
  });

  window.addEventListener('online', function () {
    if (!hasLoadedOnce) loadApp();
  });

  function initApp() {
    if (window.cordova) {
      try {
        if (window.StatusBar && cfg.statusBarColor) {
          window.StatusBar.overlaysWebView(false);
          window.StatusBar.backgroundColorByHexString(cfg.statusBarColor);
          window.StatusBar.styleLightContent();
        }
      } catch (e) {
        console.warn('StatusBar setup error:', e);
      }

      document.addEventListener('backbutton', function (e) {
        e.preventDefault();
        try {
          if (frame && frame.contentWindow && frame.contentWindow.history && frame.contentWindow.history.length > 1) {
            frame.contentWindow.history.back();
            return;
          }
        } catch (err) {
          // Cross-origin access restriction; fall through
        }

        if (backButtonPressedOnce) {
          if (navigator.app && navigator.app.exitApp) {
            navigator.app.exitApp();
          }
        } else {
          backButtonPressedOnce = true;
          if (window.plugins && window.plugins.toast) {
            window.plugins.toast.showShortBottom('Press back again to exit');
          }
          setTimeout(function () { backButtonPressedOnce = false; }, 2000);
        }
      }, false);

      requestMediaPermissions(function () {
        loadApp();
      });
    } else {
      loadApp();
    }
  }

  if (window.cordova) {
    document.addEventListener('deviceready', initApp, false);
  } else {
    initApp();
  }
})();
