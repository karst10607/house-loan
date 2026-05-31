---
name: bump-version-checklist
description: Checklist for bumping Honoka versions across all components. Run before every version bump and CWS publish. Use when preparing a new release, bumping version numbers, publishing to Chrome Web Store, or committing a new tag.
---

# Bump Version Checklist

When bumping the Honoka version, verify ALL of the following before committing.

## Version Locations (must all match)

- [ ] `chrome-extension/manifest.json` — `"version"` field
- [ ] `chrome-extension/package.json` — `"version"` field
- [ ] `honoka-bridge/package.json` — `"version"` field
- [ ] `honoka-bridge/index.js` — `const BRIDGE_VERSION = "x.y.z";` (line 1449, **NOT read from package.json**)

## CHANGELOG

- [ ] `CHANGELOG.md` — add entry for the new version with appropriate section headers

## CWS Publish (only for Chrome Web Store submission)

- [ ] `manifest.json` — remove `"key"` field (re-add for local dev after publish)
- [ ] `manifest.json` — remove `"<all_urls>"` from `host_permissions` (re-add for local dev)
- [ ] `package.json` — build script includes `--sourcemap` flag for CWS review

## Cleanup

- [ ] Remove `viewer/` directory if still present (csv-viewer removed in v1.7.0)

## After Commit & Push

- [ ] **Manually restart Bridge process** (GUI Restart button only works with cluster/systemd; plain `node index.js` must be restarted by hand)
- [ ] Reload Chrome extension (`chrome://extensions` → Reload)
- [ ] Verify version shown in Bridge terminal matches: `Honoka Bridge vX.Y.Z`
- [ ] Verify version shown in extension options page matches

## Known Pitfalls

| Pitfall | Detail |
|---------|--------|
| BRIDGE_VERSION is hardcoded | `honoka-bridge/index.js` line 1449 has `const BRIDGE_VERSION`. Updating `package.json` alone does NOT change the displayed version. |
| index.js and package.json are separate commits | If the user had already committed index.js changes, the version const can be forgotten. Always check both. |
| Indentation issues | `search_replace` may add wrong indentation; verify JSON files after edit. |
| Bridge restart doesn't auto-recover | Without cluster manager (systemd/`setup.sh`), the GUI Restart kills the process but does NOT restart it. |
