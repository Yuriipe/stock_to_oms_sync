# Boltline Base XML Sync

Local automation tool designed to run directly on Windows to synchronize multiple supplier XML / Atom feeds with BaseLinker inventories, warehouses, and price groups.

## Features

- **Dynamic BaseLinker Hierarchy Discovery:** Fetches inventories, multi-warehouse accounts, and price groups directly via your BaseLinker API token.
- **Multiple Feed Profiles:** Connect multiple supplier XML files (URLs or local `.xml` files) with individual scheduling and BaseLinker inventory/warehouse/price group targets.
- **Visual XML Field Mapper:** Auto-inspects XML files and dynamically maps tags (SKU, EAN, Price, Stock) to handle changing supplier formats without code modifications.
- **Incremental Diff Engine:** Tracks previous stock & price states in local SQLite to avoid redundant API calls and prevent rate-limiting (429).
- **Windows System Tray & Autostart:** Runs silently in the background, minimizes to the Windows taskbar tray, and supports autostart on Windows login.
- **Local Web UI:** Modern dark dashboard served at `http://127.0.0.1:3890`.

## Quick Start on Windows

1. Double click `start.bat` (or run `npm install && npm start`).
2. Go to **BaseLinker & System** tab:
   - Enter your BaseLinker API token and click **Test Connection & Fetch Hierarchy**.
   - Enable **Launch on Windows Boot** and **Minimize to System Tray** if desired.
3. In **Profiles & Sync**, click **+ Add Feed Profile**:
   - Select your target BaseLinker Inventory, Warehouse, and Price Group.
   - Enter your XML URL or local file path.
4. In **XML Field Mapper**, click **Auto-Detect XML Tags** and verify your field mappings with **Preview Parsed Items**.
5. Click **Sync Now** or let the automated background scheduler sync periodically.

## Architecture

- `src/storage/DatabaseManager.ts`: SQLite schema and data repository (`settings`, `profiles`, `sync_cache`, `sync_logs`).
- `src/baselinker/BaseLinkerClient.ts`: BaseLinker API integration with chunking (1000 items) and dynamic hierarchy discovery.
- `src/parser/XmlParserService.ts`: Streaming XML parser supporting dynamic dot-notation paths and candidate tag discovery.
- `src/diff/DiffEngine.ts`: Calculates price/stock deltas against cached states.
- `src/service/SyncCoordinator.ts`: Orchestrates ingestion, BaseLinker product ID resolution, and update dispatch.
- `src/main.ts`: Electron desktop host with system tray and Windows startup hooks.
- `public/`: UI dashboard, XML visual mapper, and log viewer.

## Building & Deploying the Binary

To generate a **single-click Windows installer (`.exe`)** ready to distribute to target machines:

```bash
npm run deploy:binary
```

- Compiles TypeScript to `dist/`.
- Packages the app using `electron-builder` with an NSIS single-click installer configuration (`oneClick: true`, desktop shortcut creation, auto-launch).
- Outputs the ready `.exe` installer inside the `release/` directory.

### Target Machine Installation
1. Transfer or download the generated `.exe` installer onto the target Windows PC.
2. Double-click the installer: it installs silently in the background, creates desktop/start shortcuts, and immediately launches the app.

## Tests

Run the test suite with:
```bash
npm test
```
All unit and integration tests are verified with deterministic in-memory SQLite and mocked network layers.

