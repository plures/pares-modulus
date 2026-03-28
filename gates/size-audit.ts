/**
 * Size audit gate — ensures plugins stay within limits.
 * Usage: npx tsx gates/size-audit.ts plugins/<name>
 */

import { readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const MAX_SOURCE_BYTES = 500 * 1024; // 500KB
const BINARY_EXTENSIONS = new Set(['.wasm', '.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.png', '.jpg', '.gif', '.mp4', '.zip', '.tar', '.gz']);

const pluginDir = process.argv[2];
if (!pluginDir) {
  console.error('Usage: size-audit.ts <plugin-dir>');
  process.exit(1);
}

let totalBytes = 0;
let fileCount = 0;
const binaryFiles: string[] = [];

function walk(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      walk(fullPath);
    } else {
      totalBytes += stat.size;
      fileCount++;
      if (BINARY_EXTENSIONS.has(extname(entry).toLowerCase())) {
        binaryFiles.push(fullPath);
      }
    }
  }
}

walk(pluginDir);

const errors: string[] = [];

if (totalBytes > MAX_SOURCE_BYTES) {
  errors.push(`Source size ${(totalBytes / 1024).toFixed(0)}KB exceeds limit of ${MAX_SOURCE_BYTES / 1024}KB`);
}

if (binaryFiles.length > 0) {
  errors.push(`Binary files not allowed: ${binaryFiles.join(', ')}`);
}

if (errors.length > 0) {
  console.error(`❌ Size audit failed:`);
  errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
} else {
  console.log(`✅ Size audit passed: ${fileCount} files, ${(totalBytes / 1024).toFixed(1)}KB total`);
}
