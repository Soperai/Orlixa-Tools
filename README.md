# Orlixa — Monaca WebView App

Wraps **https://orlixa.art/app/** in a native iOS/Android shell built for
[Monaca](https://monaca.io) (Cordova).

## How it works

This is *not* a "point `<content>` straight at the live URL" wrapper — that
approach loses native splash/offline handling. Instead `www/index.html`
is a tiny local shell that:

1. Shows a branded loading screen on launch.
2. Loads `https://orlixa.art/app/` into a full-screen `<iframe>`.
3. Fades the site in once it finishes loading.
4. Shows a "can't reach Orlixa" screen with a Retry button if the device
   is offline or the page fails to load within 15s.
5. Handles the Android hardware back button with a "press back again to
   exit" pattern (a cross-origin iframe's history isn't reachable from the
   host page, so we can't route back-button presses into in-site
   navigation).

All of that logic lives in `www/js/app.js` / `www/css/app.css`.

## Importing into Monaca

1. Zip this folder (or push it to a git repo Monaca can pull from).
2. In the Monaca IDE / Cloud IDE: **Import** → **Import Cordova/other
   project** (or **From GitHub**) and point it at this project.
3. Monaca will pick up `config.xml` automatically (app id
   `art.orlixa.app`, name "Orlixa").
4. Build → Android / iOS from the **Build** tab as usual. For iOS you'll
   need an Apple Developer account + provisioning profile as with any
   Monaca iOS build.

## Fixing "The project contains unlicensed plugins."

Monaca's Basic/Personal (free) plans can only build projects that use
Cordova's **core** plugin set. `cordova-plugin-whitelist` used to be a
core plugin, but Cordova dropped it from the core list once Cordova 10+
switched iOS to WKWebView and standardized on Content-Security-Policy
instead — Monaca's build server now treats it as an external/unlicensed
plugin. It's been removed from `config.xml` and `package.json` here; the
project already enforces the same origin restrictions via the CSP
`<meta>` tag in `www/index.html`, so no functionality is lost. The
remaining plugins (`splashscreen`, `statusbar`, `inappbrowser`,
`network-information`, plus Monaca's own `monaca-plugin-monaca-core`) are
all still on Monaca's core/first-party list, so the build should now
succeed without needing a paid plan or a custom-built debugger. If you
add other plugins later, check Monaca's **Core Cordova Plugins** docs
first — anything not on that list needs a Gold/Platinum plan (or a
custom-built debugger) even if the plugin itself is open source.

## Fixing "Android Platform 11 or later is set... splash file in auto resize mode"

Android 12 replaced the old per-density 9-patch splash screens with a
single system-managed splash (one square icon + a background color).
Monaca calls this **Auto Resize mode**, and on Platform 11+/Cordova 12
projects it's required. This is a **Monaca Cloud IDE project setting**,
not something `config.xml` alone can turn on, so you'll need to set it
once after importing:

1. Open your project in Monaca Cloud IDE.
2. Header menu → **Settings** → **Android App Settings**.
3. Under **Splash Screen**, set the mode to **Auto Resize**.
4. Upload `res/android/screen/splashscreen.png` (already included in this
   project — 288×288, icon fitted inside the required 192px safe circle)
   as the splash image.
5. Set the background color to `#0b0b14` (matches the app's dark theme).
6. Save, then go to **Plugin management** and disable the **Splashscreen**
   plugin for Android if it's still listed — Auto Resize mode replaces it,
   and Monaca's own docs note the plugin is "no longer needed" once you
   switch. (Leave it enabled if you're still building for iOS/Electron;
   it's only the Android *splash images* that this plugin no longer
   controls.)
7. Rebuild.

The old `<splash>` density entries for Android have already been removed
from `config.xml` in this project so they won't conflict with Auto Resize
mode.

## Customizing

- **Target URL**: edit `APP_URL` at the top of `www/js/app.js`.
- **App id / name / version**: edit the `<widget>` tag and `<name>` in
  `config.xml`.
- **Colors**: CSS variables at the top of `www/css/app.css`
  (`--bg`, `--accent-1`, `--accent-2`) match Orlixa's dark
  purple → cyan theme; the same colors were used to generate the app
  icon (`gen_icon.py`, not shipped in this bundle) and iOS/Electron splash
  screens under `res/`.
- **Icons / splash**: regenerate anything under `res/android`,
  `res/ios`, `res/electron` with your own artwork — the Android splash
  screens are 9-patch placeholders from the Framework7 template and were
  left untouched; replace them with real 9-patch exports if you want a
  fully custom Android splash.
- **Allowed domains**: if orlixa.art ever loads content from another
  origin (auth provider, CDN, payment iframe, etc.) add it to both the
  Content-Security-Policy `<meta>` tag in `www/index.html` and
  `<allow-navigation>` in `config.xml`.

## Native features

`cordova-plugin-inappbrowser` and `cordova-plugin-network-information`
are included so the shell can (a) open external links like `mailto:`/
`tel:`/OAuth popups in the system browser instead of hijacking the
in-app iframe, and (b) detect connectivity changes reliably across
platforms. Wire up (a) in `app.js` if orlixa.art starts opening
`target="_blank"` links you want routed externally.
