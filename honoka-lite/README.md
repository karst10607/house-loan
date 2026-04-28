# Honoka — Portable Install (v0.48.7)

Everything you need to run Honoka on your Mac. No git, no GitHub
account, no npm required.

---

## Step 0 — Pick a permanent location FIRST ⚠️

The Bridge auto-start config remembers the **exact path** of this
folder. If you install and then move/rename the folder, the Bridge
will stop working on next login.

Recommended permanent location:

```
~/Applications/honoka-portable/
```

(Or anywhere you won't move/delete. Move this folder there now,
then proceed to Step 1.)

---

## Step 1 — Run the installer (recommended: Terminal)

The installer does three things:

1. Installs Node.js v18+ if you don't have it (uses the official
   nodejs.org installer — you'll be asked for your Mac password).
2. Installs the Honoka Bridge as a background service that auto-starts
   on login.
3. Opens your browser's extensions page so you can finish Step 2.

### Recommended: open Terminal and drag the folder in

This works on every macOS version, no Gatekeeper prompts, no warnings.

1. Open **Terminal** (Spotlight: `⌘ + Space` → type `terminal` → Enter)
2. In the Terminal window, type exactly this — note the **space after `cd`** — and **don't press Enter yet**:

   ```
   cd 
   ```

3. Switch to **Finder**, find this `honoka-portable` folder, and **drag the folder into the Terminal window**. Terminal will auto-fill the full path so the line now looks like:

   ```
   cd /Users/yourname/Applications/honoka-portable-v0.48.7
   ```

4. Press **Enter**.
5. Type and press Enter:

   ```
   bash setup.sh
   ```

That's it. Follow any prompts in Terminal.

### Alternative: double-click `Install.command`

Same result, but macOS Gatekeeper may block the first run because the
script isn't signed by Apple. If `Install.command` doesn't open:

- **Sonoma 14 and earlier**: right-click `Install.command` → **Open** → **Open** again
- **Sequoia 15+**: System Settings → Privacy & Security → scroll to the bottom → **Open Anyway**
- **Or one-line bypass in Terminal** (clears the quarantine flag for the whole folder):

  ```sh
  xattr -dr com.apple.quarantine /path/to/honoka-portable-v0.48.7
  ```

Then double-click `Install.command` again.

---

## Step 2 — Load the extension into your browser (manual, ~30 seconds)

After `Install.command` finishes, your browser jumps to its
extensions page. Then:

1. Toggle **Developer mode** on (top-right corner)
2. Click **Load unpacked**
3. Select the `chrome-extension/` folder inside this folder
4. Open any Notion page — the Honoka overlay should appear

(Chrome's security model doesn't allow this step to be automated.)

---

## Where things end up

| What | Path |
|---|---|
| Your saved docs | `~/honoka-docs/` |
| Bridge logs | `~/Library/Logs/honoka-bridge/` |
| Bridge auto-start config | `~/Library/LaunchAgents/com.honoka.bridge.plist` |
| Extension folder | wherever you extracted this folder |

The Bridge listens on `localhost:7749` and only accepts connections
from your own machine. No data leaves your Mac unless you explicitly
share it.

---

## Uninstall

From inside this folder:

```sh
bash honoka-bridge/uninstall.sh
```

Then remove the extension from your browser's extensions page.

---

## Troubleshooting

**Bridge running but extension says "not connected"**
→ Reload the extension from `chrome://extensions` and refresh the
Notion tab.

**Node.js install failed**
→ Download the macOS LTS installer manually from <https://nodejs.org/>,
double-click it, then double-click `Install.command` again.

**Bridge stopped working after I moved the folder**
→ Double-click `Install.command` again from the new location. It
will rewrite the LaunchAgent with the new path.

**Bridge won't start at all**
→ Check the logs: `tail ~/Library/Logs/honoka-bridge/stderr.log`

---

Built from <https://github.com/kouzoh/c2n-dualplay> commit
`021de7d`
on 2026-04-24.
