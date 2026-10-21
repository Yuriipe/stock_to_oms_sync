import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export interface UpdateStatus {
  currentCommit: string;
  currentShortCommit: string;
  remoteCommit: string;
  remoteShortCommit: string;
  branch: string;
  hasUpdate: boolean;
  commitsBehind: number;
  commitMessages: string[];
  lastCheckedAt: string;
}

export interface UpdateApplyResult {
  success: boolean;
  message: string;
  previousCommit: string;
  newCommit: string;
  needsRestart: boolean;
}

export class AppUpdateService {
  private repoDir: string;

  constructor(repoDir: string = process.cwd()) {
    this.repoDir = repoDir;
  }

  private buildRemoteTarget(branch: string, token?: string, repoUrl?: string): string {
    if (token) {
      const cleanToken = encodeURIComponent(token.trim());
      let cleanUrl = (repoUrl || '').trim();

      // If repoUrl not provided or starts with origin, look up git remote url
      if (!cleanUrl || cleanUrl === 'origin') {
        cleanUrl = 'https://github.com/Yuriipe/stock_to_oms_sync.git';
      }

      // Convert https://github.com/owner/repo.git to https://x-access-token:<token>@github.com/owner/repo.git
      if (cleanUrl.startsWith('https://')) {
        const withoutHttps = cleanUrl.replace(/^https:\/\/[^@]*@?/, '');
        const authenticatedUrl = `https://x-access-token:${cleanToken}@${withoutHttps}`;
        return `"${authenticatedUrl}" ${branch}`;
      }
    }
    return `origin ${branch}`;
  }

  /**
   * Checks the remote Git repository for updates on the active branch
   */
  public async checkForUpdates(options?: { token?: string; repoUrl?: string }): Promise<UpdateStatus> {
    try {
      // 1. Get current branch
      const { stdout: branchOut } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.repoDir
      });
      const branch = branchOut.trim() || 'main';

      // 2. Fetch origin (using token if supplied, with GIT_TERMINAL_PROMPT=0 to prevent hanging)
      const fetchTarget = this.buildRemoteTarget(branch, options?.token, options?.repoUrl);
      await execAsync(`git fetch ${fetchTarget}`, {
        cwd: this.repoDir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: 25000
      });

      // 3. Local commit hash
      const { stdout: localOut } = await execAsync('git rev-parse HEAD', { cwd: this.repoDir });
      const currentCommit = localOut.trim();

      // 4. Remote commit hash (FETCH_HEAD is always updated by git fetch)
      const { stdout: remoteOut } = await execAsync(`git rev-parse FETCH_HEAD`, {
        cwd: this.repoDir
      });
      const remoteCommit = remoteOut.trim();

      // 5. Commits behind count
      const { stdout: countOut } = await execAsync(
        `git rev-list --count HEAD..FETCH_HEAD`,
        { cwd: this.repoDir }
      );
      const commitsBehind = parseInt(countOut.trim(), 10) || 0;

      // 6. Detailed log messages if behind
      let commitMessages: string[] = [];
      if (commitsBehind > 0) {
        const { stdout: logOut } = await execAsync(
          `git log HEAD..FETCH_HEAD --oneline -n 10`,
          { cwd: this.repoDir }
        );
        commitMessages = logOut
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
      }

      return {
        currentCommit,
        currentShortCommit: currentCommit.slice(0, 7),
        remoteCommit,
        remoteShortCommit: remoteCommit.slice(0, 7),
        branch,
        hasUpdate: commitsBehind > 0 || currentCommit !== remoteCommit,
        commitsBehind,
        commitMessages,
        lastCheckedAt: new Date().toISOString()
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('could not read Username') || errMsg.includes('Authentication failed')) {
        throw new Error('Authentication required for private repository. Please configure a GitHub Personal Access Token in Settings.');
      }
      throw new Error(`Failed to check for updates: ${errMsg}`);
    }
  }

  /**
   * Pulls the latest code, rebuilds TypeScript, and returns update result
   */
  public async applyUpdate(options?: { token?: string; repoUrl?: string }): Promise<UpdateApplyResult> {
    try {
      const { stdout: branchOut } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.repoDir
      });
      const branch = branchOut.trim() || 'main';

      const { stdout: prevOut } = await execAsync('git rev-parse HEAD', { cwd: this.repoDir });
      const previousCommit = prevOut.trim();

      // Pull updates (authenticated if token provided)
      const pullTarget = this.buildRemoteTarget(branch, options?.token, options?.repoUrl);
      await execAsync(`git pull ${pullTarget}`, {
        cwd: this.repoDir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: 45000
      });

      // Recompile TypeScript
      await execAsync('npm run build', {
        cwd: this.repoDir,
        timeout: 60000
      });

      const { stdout: newOut } = await execAsync('git rev-parse HEAD', { cwd: this.repoDir });
      const newCommit = newOut.trim();

      return {
        success: true,
        message: 'Application updated and rebuilt successfully!',
        previousCommit: previousCommit.slice(0, 7),
        newCommit: newCommit.slice(0, 7),
        needsRestart: true
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('could not read Username') || errMsg.includes('Authentication failed')) {
        throw new Error('Authentication failed for private repository. Please check your GitHub Token in Settings.');
      }
      throw new Error(`Failed to apply update: ${errMsg}`);
    }
  }

  /**
   * Restarts the Electron desktop application
   */
  public restartApp(electronApp?: { relaunch: () => void; exit: (code: number) => void }): void {
    if (electronApp && typeof electronApp.relaunch === 'function') {
      electronApp.relaunch();
      electronApp.exit(0);
    } else {
      // Fallback for standalone/dev server mode
      setTimeout(() => {
        process.exit(0);
      }, 500);
    }
  }
}
