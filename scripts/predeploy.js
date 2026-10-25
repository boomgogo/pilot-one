// Warns when deploying a dirty tree: the version label (v.<sha>) would not match the deployed code.
import { execSync } from 'node:child_process';

try {
  const sha = execSync('git rev-parse HEAD').toString().trim();
  const dirty = execSync('git status --porcelain --untracked-files=no').toString().trim();
  console.log(`deploying v.${sha.slice(0, 4)} (${sha})`);
  if (dirty) {
    console.warn('\n⚠  Working tree has uncommitted changes; the version label will not match the deployed code:\n' + dirty + '\n');
  }
} catch {
  console.warn('⚠  Not a git checkout; version label will be v.0000');
}
