const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');

console.log('====================================================');
console.log('  XMLsync: Binary Deployment Builder  ');
console.log('====================================================\n');

try {
  // 1. Run TypeScript build
  console.log('[1/3] Building TypeScript sources...');
  execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });

  // 2. Package with electron-builder
  if (process.platform === 'darwin') {
    console.warn('\n[Notice] You are running on macOS. Direct cross-compilation of better-sqlite3 for Windows is not supported by node-gyp.');
    console.warn('-> To get the Windows .exe installer without dev tools, push to GitHub to let GitHub Actions build the Windows installer automatically.');
    console.warn('-> Building for macOS locally instead...\n');
    execSync('npx electron-builder --mac', { cwd: ROOT_DIR, stdio: 'inherit' });
  } else {
    console.log('\n[2/3] Packaging Windows binary (single-click NSIS installer)...');
    execSync('npx electron-builder --win', { cwd: ROOT_DIR, stdio: 'inherit' });
  }

  // 3. Locate generated installer binary
  console.log('\n[3/3] Inspecting release output...');
  if (!fs.existsSync(RELEASE_DIR)) {
    throw new Error(`Release directory not found at ${RELEASE_DIR}`);
  }

  const files = fs.readdirSync(RELEASE_DIR);
  const installers = files.filter(f => f.endsWith('.exe') && !f.includes('elevate'));

  if (installers.length === 0) {
    console.warn('Notice: Built files produced, but no .exe detected in release folder.');
    console.log('Release directory contents:', files);
  } else {
    console.log('\n====================================================');
    console.log(' BUILD SUCCESSFUL! Single-Click Installer Ready:');
    installers.forEach(installer => {
      const fullPath = path.join(RELEASE_DIR, installer);
      const stats = fs.statSync(fullPath);
      const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
      console.log(` -> ${installer} (${sizeMb} MB)`);
      console.log(`    Location: ${fullPath}`);
    });
    console.log('====================================================\n');
    console.log('Instructions for target machine:');
    console.log('1. Download/transfer the .exe installer to the target machine.');
    console.log('2. Double-click the file to install and automatically launch the app.');
  }
} catch (error) {
  console.error('\n[Error] Deployment build failed:', error.message || error);
  process.exit(1);
}
