import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Resolves a given file path by checking:
 * 1. The exact given path
 * 2. Absolute path from current working directory
 * 3. User's Downloads directory (common when exporting feeds from browser)
 * 4. User's Desktop directory
 * 5. User's Documents directory
 * 6. User's Home directory
 *
 * Returns the resolved existing path, or null if not found.
 */
export function resolveLocalFilePath(inputPath: string): string | null {
  if (!inputPath || typeof inputPath !== 'string') {
    return null;
  }

  const trimmed = inputPath.trim();
  if (!trimmed) {
    return null;
  }

  // 1. Check exact path as given
  if (fs.existsSync(trimmed)) {
    return path.resolve(trimmed);
  }

  // 2. Relative to cwd
  const cwdCandidate = path.resolve(process.cwd(), trimmed);
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  // If path has directory parts or is just a basename, try candidate directories
  const baseName = path.basename(trimmed);
  const home = os.homedir();
  const searchDirs = [
    path.join(home, 'Downloads'),
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    home,
    process.cwd()
  ];

  for (const dir of searchDirs) {
    const candidate = path.join(dir, baseName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
