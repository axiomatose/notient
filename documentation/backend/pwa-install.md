# Installing the web app (PWA)

**Status:** ✅ manifest fixed | ⏳ needs HTTPS to install on Android

## Key Details
- The manifest comes from `app/app.json`: `icons` (192×192 and 512×512 `any`, 1024×1024 `maskable`), `theme_color`, `background_color`, `display: standalone`, `start_url: /`.
- Chrome on Android offers install only when the manifest has a 192 and a 512 icon (it lacked the 192 before: "this app can not be installed") **and** the page is served over HTTPS (or `localhost`). The app served over plain `http://` on a LAN/VPN address cannot be installed: put it behind HTTPS (reverse proxy) for install.
- iOS uses the 1024 maskable icon for the app icon and the apple-touch-icon; the web favicon is the 192 `any` one (transparent corners).

## Self-hosted server (app)
- Sign-in page → "Use your own server": address kept on device (`secret.keep server`), blank = build default (`API_BASE_URL`); saving signs out (tokens are per server).
- `app.ts`: `originOf(store)` for every fetch; live socket derives `ws(s)://` from it. Grants: `net.fetch https:` + `local-network`, `net.websocket wss:` + `local-network` (plain `http://` only on LAN/loopback: App Transport Security).
- Address format validated `^https?://host[:port][/path]`; trailing `/` stripped.
