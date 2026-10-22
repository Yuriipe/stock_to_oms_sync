import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SyncSchedulerService } from '../../src/service/SyncSchedulerService';
import { DatabaseManager } from '../../src/storage/DatabaseManager';
import { SyncCoordinator } from '../../src/service/SyncCoordinator';
import { XmlParserService } from '../../src/parser/XmlParserService';
import { DiffEngine } from '../../src/diff/DiffEngine';
import { FeedProfile } from '../../src/types';

describe('SyncSchedulerService', () => {
  let db: DatabaseManager;
  let coordinator: SyncCoordinator;
  let scheduler: SyncSchedulerService;

  const testProfile: FeedProfile = {
    id: 'sched-profile-1',
    name: 'Scheduled Profile',
    enabled: true,
    sourceType: 'file',
    sourcePath: '/path/to/feed.xml',
    targetInventoryId: 100,
    targetWarehouseId: 'bl_1',
    targetPriceGroupId: 10,
    identifierField: 'sku',
    mapping: {
      itemTag: 'item',
      identifierField: 'sku',
      skuPath: 'sku',
      eanPath: 'ean',
      pricePath: 'price',
      stockPath: 'stock'
    },
    syncIntervalMinutes: 30
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = new DatabaseManager(':memory:');
    db.initialize();
    db.saveProfile(testProfile);

    coordinator = new SyncCoordinator(db, new XmlParserService(), new DiffEngine(db));
    scheduler = new SyncSchedulerService(db, coordinator, { checkIntervalMs: 1000 });
  });

  afterEach(() => {
    scheduler.stop();
  });

  it('does not trigger sync when offline', async () => {
    vi.spyOn(scheduler, 'checkInternetConnectivity').mockResolvedValue(false);
    const syncSpy = vi.spyOn(coordinator, 'syncProfile').mockResolvedValue({
      profileId: testProfile.id,
      success: true,
      itemsProcessed: 0,
      pricesUpdated: 0,
      stocksUpdated: 0,
      message: 'ok'
    });

    await scheduler.tick();
    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('triggers sync when online and interval (30 min) has passed', async () => {
    vi.spyOn(scheduler, 'checkInternetConnectivity').mockResolvedValue(true);
    const syncSpy = vi.spyOn(coordinator, 'syncProfile').mockResolvedValue({
      profileId: testProfile.id,
      success: true,
      itemsProcessed: 5,
      pricesUpdated: 1,
      stocksUpdated: 1,
      message: 'ok'
    });

    // Profile has no lastSyncAt yet, so it is overdue
    await scheduler.tick();
    expect(syncSpy).toHaveBeenCalledWith(testProfile.id);
  });

  it('triggers sync as soon as connection is back after an internet error / disconnect', async () => {
    const syncSpy = vi.spyOn(coordinator, 'syncProfile').mockResolvedValue({
      profileId: testProfile.id,
      success: true,
      itemsProcessed: 5,
      pricesUpdated: 0,
      stocksUpdated: 0,
      message: 'ok'
    });

    // 1. Simulate recent sync with error status (e.g. internet down)
    const recentTime = new Date().toISOString();
    const erroredProfile = {
      ...testProfile,
      lastSyncAt: recentTime,
      lastSyncStatus: 'error' as const,
      lastSyncMessage: 'getaddrinfo ENOTFOUND api.baselinker.com'
    };
    db.saveProfile(erroredProfile);

    // 2. Tick while offline -> should not sync
    vi.spyOn(scheduler, 'checkInternetConnectivity').mockResolvedValue(false);
    await scheduler.tick();
    expect(syncSpy).not.toHaveBeenCalled();

    // 3. Tick when connection is restored -> should immediately trigger sync
    vi.spyOn(scheduler, 'checkInternetConnectivity').mockResolvedValue(true);
    await scheduler.tick();
    expect(syncSpy).toHaveBeenCalledWith(testProfile.id);
  });
});
