import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveLocalFilePath } from '../../src/utils/fileResolver';

describe('fileResolver', () => {
  const testFileName = `test_feed_${Date.now()}.xml`;
  const tempFilePath = path.join(os.tmpdir(), testFileName);
  const downloadsPath = path.join(os.homedir(), 'Downloads', testFileName);

  beforeEach(() => {
    fs.writeFileSync(tempFilePath, '<root><item><id>1</id></item></root>', 'utf-8');
  });

  afterEach(() => {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    if (fs.existsSync(downloadsPath)) {
      fs.unlinkSync(downloadsPath);
    }
  });

  it('resolves exact absolute paths', () => {
    const resolved = resolveLocalFilePath(tempFilePath);
    expect(resolved).toBe(path.resolve(tempFilePath));
  });

  it('returns null for non-existent files', () => {
    const resolved = resolveLocalFilePath('non_existent_file_xyz_12345.xml');
    expect(resolved).toBeNull();
  });

  it('resolves filename found in Downloads folder', () => {
    fs.writeFileSync(downloadsPath, '<root><item><id>2</id></item></root>', 'utf-8');
    const resolved = resolveLocalFilePath(testFileName);
    expect(resolved).toBe(downloadsPath);
  });

  it('handles null, undefined or empty strings gracefully', () => {
    expect(resolveLocalFilePath('')).toBeNull();
    // @ts-ignore
    expect(resolveLocalFilePath(null)).toBeNull();
    // @ts-ignore
    expect(resolveLocalFilePath(undefined)).toBeNull();
  });
});
