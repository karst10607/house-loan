# Honoka Lite Privacy Policy

**Last updated: 2026-05-31**

## Data Collection

Honoka Lite collects and stores the following data **locally on your device**:

- **Browsing history on Notion**: Page titles, URLs, and timestamps of Notion pages you visit while the extension is active.
- **Extension settings**: Your folder organization, visible/hidden columns, sort preferences, and flags.
- **Notion content (optional)**: When you use the clip feature, the page content and title are saved locally.

## Data Storage

All data is stored using the `chrome.storage.local` API and/or IndexedDB in your browser. **No data is sent to any external server** except:

- **Notion API** (notion.so): When you explicitly choose to export/sync data to Notion pages.
- **Local Bridge** (127.0.0.1:44124): When you enable the Bridge feature, data is sent to a local HTTP server running on your own machine. No data leaves your computer.

## Data Sharing

Honoka Lite does **not** sell, share, or transmit your data to any third party. The extension has **no telemetry, no analytics, no advertising**.

## Permissions

- `activeTab` — access the current Notion tab to extract page info
- `scripting` — inject token counting logic into Notion pages
- `storage` — save your history and settings locally
- `history` — read Chrome history to find previously visited Notion pages

## Data Removal

You can delete all stored data at any time via:
1. Extension options → Export/Import → Clear All Data
2. Chrome settings → Extensions → Honoka Lite → Clear Storage
3. Uninstalling the extension

## Contact

For questions, open an issue at: https://github.com/karst10607/house-loan
