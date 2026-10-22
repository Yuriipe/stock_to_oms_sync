import dns from 'dns';
import { DatabaseManager } from '../storage/DatabaseManager';
import { SyncCoordinator } from './SyncCoordinator';

export class SyncSchedulerService {
  private db: DatabaseManager;
  private syncCoordinator: SyncCoordinator;
  private timer: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;
  private isChecking: boolean = false;
  private wasOffline: boolean = false;

  constructor(
    db: DatabaseManager,
    syncCoordinator: SyncCoordinator,
    options?: { checkIntervalMs?: number }
  ) {
    this.db = db;
    this.syncCoordinator = syncCoordinator;
    this.checkIntervalMs = options?.checkIntervalMs ?? 15 * 1000; // Check every 15s for quick retry on reconnection
  }

  /**
   * Probes external internet connectivity using DNS lookup.
   */
  public async checkInternetConnectivity(): Promise<boolean> {
    return new Promise((resolve) => {
      dns.lookup('api.baselinker.com', (err) => {
        if (!err) {
          return resolve(true);
        }
        // Fallback to check 1.1.1.1
        dns.lookup('one.one.one.one', (fallbackErr) => {
          resolve(!fallbackErr);
        });
      });
    });
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error('[Scheduler Error]:', err));
    }, this.checkIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async tick(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const isOnline = await this.checkInternetConnectivity();
      const justCameOnline = this.wasOffline && isOnline;
      this.wasOffline = !isOnline;

      if (!isOnline) {
        // No internet connection; do not fire any scheduled runs
        return;
      }

      const profiles = this.db.getProfiles();
      const now = Date.now();

      for (const profile of profiles) {
        if (!profile.enabled) continue;

        const intervalMs = (profile.syncIntervalMinutes || 30) * 60 * 1000;
        const lastSuccess = profile.lastSyncAt ? new Date(profile.lastSyncAt).getTime() : 0;
        const isOverdue = now - lastSuccess >= intervalMs;
        const hadPreviousError = profile.lastSyncStatus === 'error';

        // Trigger if:
        // 1. Regular interval elapsed (30 minutes by default)
        // 2. Previous attempt failed (e.g. internet error) and connection was restored or is online
        // 3. Internet was restored just now and profile is overdue or in error
        if (isOverdue || hadPreviousError || justCameOnline) {
          console.log(
            `[Scheduler] Auto-sync triggered for profile "${profile.name}" (Reason: ${
              justCameOnline
                ? 'internet restored'
                : hadPreviousError
                ? 'retrying after error'
                : 'scheduled interval'
            })`
          );
          await this.syncCoordinator.syncProfile(profile.id).catch((err) => {
            console.error(`[Scheduler] Sync failed for profile "${profile.name}":`, err);
          });
        }
      }
    } finally {
      this.isChecking = false;
    }
  }
}
