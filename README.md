# Boltline Base XML Sync

Local automation tool designed to run directly on Windows to synchronize multiple supplier XML / Atom feeds with BaseLinker inventories, warehouses, and price groups.

## Features

- **Dynamic BaseLinker Hierarchy Discovery:** Fetches inventories, multi-warehouse accounts, and price groups directly via your BaseLinker API token.
- **Strict Rate Limiting (< 50 QPM):** Built-in query throttling guarantees API calls remain safely below BaseLinker's 50 requests/minute quota.
- **Local BaseLinker Products SQLite Cache & Viewer:** Caches BaseLinker product IDs, SKUs, and EANs with full pagination (`getInventoryProductsList`) to avoid repetitive catalog lookups. Includes an in-dashboard modal with on-demand **"🔄 Refresh from BaseLinker"** capability.
- **Zero-Price Protection:** Strictly prevents 0.00 or negative price overrides from syncing or auto-creating catalog products in BaseLinker.
- **Catalog Warehouse ID Normalization:** Automatically standardizes warehouse IDs (e.g. `bl_57486`) to conform with BaseLinker API requirements.
- **Auto-Creation of Missing Items (`stock > 0` & `price > 0`):** Products present in the XML feed that do not yet exist in BaseLinker are automatically created in the catalog via `addInventoryProduct`.
- **Standard / Fixed Stock Setting:** Optionally define a constant stock value per feed profile that overrides feed stock levels to keep inventory at a guaranteed level.
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
   - Choose **Source Type**: Remote URL (HTTP/HTTPS) or Local XML File (.xml) with file browser picker support.
   - (Optional) Set **Standard / Fixed Stock** to enforce a fixed stock level whenever in stock.
4. In **XML Field Mapper**, click **Auto-Detect XML Tags** and verify your field mappings with **Preview Parsed Items**.
5. Click **Sync Now** or let the automated background scheduler sync periodically.

## Architecture

- `src/storage/DatabaseManager.ts`: SQLite schema and data repository (`settings`, `profiles`, `sync_cache`, `sync_logs`, `baselinker_products`).
- `src/baselinker/BaseLinkerClient.ts`: BaseLinker API integration with < 50 QPM rate limiting, nested dictionary payloads, chunking (1000 items), product creation (`addInventoryProduct`), and dynamic hierarchy discovery.
- `src/parser/XmlParserService.ts`: Streaming XML parser supporting dynamic dot-notation paths and candidate tag discovery.
- `src/diff/DiffEngine.ts`: Calculates price/stock deltas against cached states.
- `src/service/SyncCoordinator.ts`: Orchestrates ingestion, BaseLinker product ID resolution, pagination sync, auto-creation of missing items, and update dispatch.
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

