import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import https from 'https';

const execFileAsync = promisify(execFile);

/**
 * Returns environment variables with guaranteed Windows system variables (ComSpec, SystemRoot, PATH)
 */
function getExecEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const baseEnv: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
    const comSpec = process.env.ComSpec || process.env.COMSPEC || `${systemRoot}\\System32\\cmd.exe`;
    baseEnv.SystemRoot = systemRoot;
    baseEnv.ComSpec = comSpec;

    // Ensure system directories and Git are on PATH if missing
    const currentPath = baseEnv.PATH || baseEnv.Path || '';
    const systemPaths = [
      `${systemRoot}\\System32`,
      systemRoot,
      `${systemRoot}\\System32\\Wbem`,
      `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\`,
      'C:\\Program Files\\Git\\cmd',
      'C:\\Program Files\\nodejs'
    ];
    baseEnv.PATH = `${currentPath};${systemPaths.join(';')}`;
  }
  return baseEnv;
}

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
  downloadUrl?: string;
  releaseTag?: string;
}

export interface UpdateApplyResult {
  success: boolean;
  message: string;
  previousCommit: string;
  newCommit: string;
  needsRestart: boolean;
  downloadUrl?: string;
}

export class AppUpdateService {
  private repoDir: string;

  constructor(repoDir: string = process.cwd()) {
    this.repoDir = repoDir;
  }

  private isGitRepository(): boolean {
    try {
      return fs.existsSync(path.join(this.repoDir, '.git'));
    } catch {
      return false;
    }
  }

  private getCurrentPackageVersion(): string {
    try {
      const pkgPath = path.join(this.repoDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return pkg.version || '1.0.0';
      }
    } catch {}
    return '1.0.0';
  }

  private async fetchLatestGitHubRelease(token?: string, repoUrl?: string): Promise<{
    tagName: string;
    body: string;
    downloadUrl?: string;
  } | null> {
    return new Promise((resolve) => {
      let repoOwner = 'Yuriipe';
      let repoName = 'stock_to_oms_sync';

      if (repoUrl && repoUrl.includes('github.com/')) {
        const parts = repoUrl.split('github.com/')[1].replace(/\.git$/, '').split('/');
        if (parts.length >= 2) {
          repoOwner = parts[0];
          repoName = parts[1];
        }
      }

      const headers: Record<string, string> = {
        'User-Agent': 'XMLsync-UpdateService',
        'Accept': 'application/vnd.github.v3+json'
      };
      if (token) {
        headers['Authorization'] = `token ${token.trim()}`;
      }

      const req = https.get(
        {
          hostname: 'api.github.com',
          path: `/repos/${repoOwner}/${repoName}/releases/latest`,
          headers,
          timeout: 15000
        },
        (res) => {
          let raw = '';
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const data = JSON.parse(raw);
                let downloadUrl: string | undefined = undefined;
                if (data.assets && Array.isArray(data.assets)) {
                  const exeAsset = data.assets.find((a: any) => a.name && a.name.endsWith('.exe'));
                  if (exeAsset) {
                    downloadUrl = exeAsset.browser_download_url;
                  }
                }
                resolve({
                  tagName: data.tag_name || '',
                  body: data.body || '',
                  downloadUrl: downloadUrl || data.html_url
                });
              } catch {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          });
        }
      );

      req.on('error', () => resolve(null));
      req.setTimeout(15000, () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  /**
   * Checks the remote Git repository or GitHub Releases for updates
   */
  public async checkForUpdates(options?: { token?: string; repoUrl?: string }): Promise<UpdateStatus> {
    const hasGit = this.isGitRepository();

    // 1. If not a git clone (e.g. installed Windows desktop app), check GitHub Releases API
    if (!hasGit) {
      const currentVersion = this.getCurrentPackageVersion();
      const release = await this.fetchLatestGitHubRelease(options?.token, options?.repoUrl);

      if (!release) {
        return {
          currentCommit: `v${currentVersion}`,
          currentShortCommit: `v${currentVersion}`,
          remoteCommit: `v${currentVersion}`,
          remoteShortCommit: `v${currentVersion}`,
          branch: 'release',
          hasUpdate: false,
          commitsBehind: 0,
          commitMessages: [],
          lastCheckedAt: new Date().toISOString()
        };
      }

      const remoteTag = release.tagName.replace(/^v/, '');
      const hasUpdate = remoteTag !== currentVersion && remoteTag > currentVersion;

      return {
        currentCommit: `v${currentVersion}`,
        currentShortCommit: `v${currentVersion}`,
        remoteCommit: release.tagName,
        remoteShortCommit: release.tagName,
        branch: 'release',
        hasUpdate,
        commitsBehind: hasUpdate ? 1 : 0,
        commitMessages: release.body ? [release.body.slice(0, 150)] : [],
        lastCheckedAt: new Date().toISOString(),
        downloadUrl: release.downloadUrl,
        releaseTag: release.tagName
      };
    }

    // 2. In a git repository: run git commands directly with execFile (avoiding cmd.exe ENOENT)
    try {
      const execEnv = getExecEnv({ GIT_TERMINAL_PROMPT: '0' });

      // Branch
      const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: this.repoDir,
        env: execEnv
      });
      const branch = branchOut.trim() || 'main';

      // Remote URL & fetch
      let remoteTarget = 'origin';
      if (options?.token) {
        const cleanToken = encodeURIComponent(options.token.trim());
        let cleanUrl = (options.repoUrl || '').trim();
        if (!cleanUrl || cleanUrl === 'origin') {
          cleanUrl = 'https://github.com/Yuriipe/stock_to_oms_sync.git';
        }
        if (cleanUrl.startsWith('https://')) {
          const withoutHttps = cleanUrl.replace(/^https:\/\/[^@]*@?/, '');
          remoteTarget = `https://x-access-token:${cleanToken}@${withoutHttps}`;
        }
      }

      await execFileAsync('git', ['fetch', remoteTarget, branch], {
        cwd: this.repoDir,
        env: execEnv,
        timeout: 25000
      });

      // Local commit
      const { stdout: localOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: this.repoDir,
        env: execEnv
      });
      const currentCommit = localOut.trim();

      // Remote commit
      const { stdout: remoteOut } = await execFileAsync('git', ['rev-parse', 'FETCH_HEAD'], {
        cwd: this.repoDir,
        env: execEnv
      });
      const remoteCommit = remoteOut.trim();

      // Commits behind count
      const { stdout: countOut } = await execFileAsync('git', ['rev-list', '--count', 'HEAD..FETCH_HEAD'], {
        cwd: this.repoDir,
        env: execEnv
      });
      const commitsBehind = parseInt(countOut.trim(), 10) || 0;

      // Commit log messages
      let commitMessages: string[] = [];
      if (commitsBehind > 0) {
        const { stdout: logOut } = await execFileAsync('git', ['log', 'HEAD..FETCH_HEAD', '--oneline', '-n', '10'], {
          cwd: this.repoDir,
          env: execEnv
        });
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
      if (errMsg.includes('ENOENT')) {
        // Fallback to checking GitHub release directly if git binary cannot be found
        const currentVersion = this.getCurrentPackageVersion();
        const release = await this.fetchLatestGitHubRelease(options?.token, options?.repoUrl);
        if (release) {
          const remoteTag = release.tagName.replace(/^v/, '');
          const hasUpdate = remoteTag !== currentVersion && remoteTag > currentVersion;
          return {
            currentCommit: `v${currentVersion}`,
            currentShortCommit: `v${currentVersion}`,
            remoteCommit: release.tagName,
            remoteShortCommit: release.tagName,
            branch: 'release',
            hasUpdate,
            commitsBehind: hasUpdate ? 1 : 0,
            commitMessages: release.body ? [release.body.slice(0, 150)] : [],
            lastCheckedAt: new Date().toISOString(),
            downloadUrl: release.downloadUrl,
            releaseTag: release.tagName
          };
        }
      }
      throw new Error(`Failed to check for updates: ${errMsg}`);
    }
  }

  /**
   * Pulls the latest code, rebuilds TypeScript, and returns update result
   */
  public async applyUpdate(options?: { token?: string; repoUrl?: string }): Promise<UpdateApplyResult> {
    const hasGit = this.isGitRepository();
    if (!hasGit) {
      const release = await this.fetchLatestGitHubRelease(options?.token, options?.repoUrl);
      const downloadLink = release?.downloadUrl || 'https://github.com/Yuriipe/stock_to_oms_sync/releases';
      return {
        success: true,
        message: 'Dostępna nowa wersja instalatora.',
        downloadUrl: downloadLink,
        previousCommit: 'installed',
        newCommit: release?.tagName || 'latest',
        needsRestart: false
      };
    }

    try {
      const execEnv = getExecEnv({ GIT_TERMINAL_PROMPT: '0' });

      const { stdout: branchOut } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: this.repoDir,
        env: execEnv
      });
      const branch = branchOut.trim() || 'main';

      const { stdout: prevOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: this.repoDir,
        env: execEnv
      });
      const previousCommit = prevOut.trim();

      // Remote target
      let remoteTarget = 'origin';
      if (options?.token) {
        const cleanToken = encodeURIComponent(options.token.trim());
        let cleanUrl = (options.repoUrl || '').trim();
        if (!cleanUrl || cleanUrl === 'origin') {
          cleanUrl = 'https://github.com/Yuriipe/stock_to_oms_sync.git';
        }
        if (cleanUrl.startsWith('https://')) {
          const withoutHttps = cleanUrl.replace(/^https:\/\/[^@]*@?/, '');
          remoteTarget = `https://x-access-token:${cleanToken}@${withoutHttps}`;
        }
      }

      await execFileAsync('git', ['pull', remoteTarget, branch], {
        cwd: this.repoDir,
        env: execEnv,
        timeout: 45000
      });

      // Recompile TypeScript
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      await execFileAsync(npmCmd, ['run', 'build'], {
        cwd: this.repoDir,
        env: execEnv,
        timeout: 60000
      });

      const { stdout: newOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: this.repoDir,
        env: execEnv
      });
      const newCommit = newOut.trim();

      return {
        success: true,
        message: 'Aplikacja została zaktualizowana i przebudowana pomyślnie!',
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
      setTimeout(() => {
        process.exit(0);
      }, 500);
    }
  }
}
