# Packaging the Logarium extension for permanent install

The dev loop (`npm run build` → load `dist/` unpacked) is temporary on Firefox
and nag-prone on Chrome. For a permanent install, package and distribute as
below. All commands run from `extension/` after `npm install`.

Production build talks to the deployed backend via `.env.production`
(`VITE_API_BASE=https://lingweispc.ddns.net:6443`); `npm run build` and the
`package`/`sign:firefox` scripts use it automatically.

## Firefox — signed unlisted `.xpi` (free, permanent)

Regular Firefox refuses unsigned add-ons, and `about:debugging` loads vanish on
restart. Sign through Mozilla's **unlisted** channel (automated review, no public
listing, no fee). The manifest already carries the required
`browser_specific_settings.gecko.id` (`logarium@leweixu.dev`).

1. Get API credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Export them and sign:
   ```bash
   export WEB_EXT_API_KEY="user:xxxxxxxx:123"
   export WEB_EXT_API_SECRET="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
   npm run sign:firefox
   ```
3. The signed `.xpi` lands in `dist-artifacts/`. Install it permanently:
   `about:addons` → gear → **Install Add-on From File…** → pick the `.xpi`.

Bump `version` in `public/manifest.json` for every new signed build (AMO rejects
duplicate versions).

Alternative, no signing: **Firefox Developer Edition / ESR / Nightly** with
`about:config` → `xpinstall.signatures.required = false`, then install the
unsigned zip from `npm run package`. Does not work on release Firefox.

## Chrome — unlisted Chrome Web Store item

Unpacked loads persist across restarts but nag on every startup. For a clean
install, publish privately:

1. `npm run package` → produces `dist-artifacts/logarium-<version>-chrome.zip`.
2. One-time: register at the
   [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   ($5 lifetime fee).
3. **New item** → upload the zip → set **Visibility: Unlisted** → fill the store
   listing. Expect to justify the broad permissions in review:
   - `<all_urls>` host access + `cookies` + `declarativeNetRequestWithHostAccess`
     are used to fetch a cover image first-party and attach the user's own
     `cf_clearance` cookie so Cloudflare-gated covers (NovelUpdates) can be
     cached. No browsing data is read or transmitted beyond the cover bytes.
4. After approval, install from your private item URL. Updates: bump `version`,
   re-`package`, upload a new draft.

## Cross-browser notes

- The manifest declares both `background.service_worker` (Chrome) and
  `background.scripts` (Firefox); each browser ignores the other key.
- `npm run lint` (`web-ext lint`) surfaces store-blocking issues before upload.
  Warnings about the dual `background` keys are expected and harmless.
