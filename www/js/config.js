/* Orlixa — app configuration.
 * The ONLY file you normally need to edit. Loaded before app.js.
 * Invalid values fall back to the defaults in app.js (with a console warning).
 */
window.ORLIXA_CONFIG = {
  // Site this app wraps (must be https)
  appUrl: 'https://orlixa.art/app/',

  // 'direct': open the site as the top-level page (recommended)
  // 'iframe': keep it inside the shell (server must allow framing)
  loadMode: 'direct',

  // Max time (ms) to wait for the site before showing the error screen
  timeoutMs: 15000,

  // Delay (ms) before revealing the iframe, avoids a visual flash
  revealDelayMs: 150,

  // Android permissions requested at launch (never blocks loading if denied)
  permissions: [
    'android.permission.CAMERA',
    'android.permission.RECORD_AUDIO'
  ],

  // Status bar
  statusBarColor: '#0b0b14',

  // Error-screen messages
  messages: {
    offline:     'You appear to be offline. Check your connection and try again.',
    timeout:     'Orlixa took too long to respond. Please try again.',
    unreachable: 'Could not reach Orlixa. Check your connection and try again.'
  }
};
