import { describe, it, expect, vi } from 'vitest';
import { AppUpdateService } from '../../src/service/AppUpdateService';

describe('AppUpdateService', () => {
  it('instantiates with repoDir', () => {
    const service = new AppUpdateService('/test/dir');
    expect(service).toBeDefined();
  });

  it('checks updates in current git repository', async () => {
    const service = new AppUpdateService(process.cwd());
    const status = await service.checkForUpdates();

    expect(status).toHaveProperty('currentCommit');
    expect(status).toHaveProperty('currentShortCommit');
    expect(status).toHaveProperty('remoteCommit');
    expect(status).toHaveProperty('branch');
    expect(status).toHaveProperty('hasUpdate');
    expect(typeof status.commitsBehind).toBe('number');
    expect(Array.isArray(status.commitMessages)).toBe(true);
    expect(status.currentCommit.length).toBe(40);
  });
});
