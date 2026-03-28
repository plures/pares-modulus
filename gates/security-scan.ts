/**
 * Security scan gate — checks for hardcoded secrets and suspicious patterns.
 * Usage: npx tsx gates/security-scan.ts plugins/<name>
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const pluginDir = process.argv[2];
if (!pluginDir) {
  console.error('Usage: security-scan.ts <plugin-dir>');
  process.exit(1);
}

const SECRET_PATTERNS = [
  { name: 'AWS Key', pattern: /AKIA[0-9A-Z]{16}/g },
  { name: 'Private Key', pattern: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g },
  { name: 'GitHub Token', pattern: /gh[ps]_[A-Za-z0-9_]{36,}/g },
  { name: 'Generic API Key', pattern: /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+/=]{20,}['"]/gi },
  { name: 'npm Token', pattern: /npm_[A-Za-z0-9]{36}/g },
  { name: 'Hardcoded Password', pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/gi },
  { name: 'Bearer Token', pattern: /Bearer\s+[A-Za-z0-9+/=._-]{20,}/g },
];

const SCAN_EXTENSIONS = new Set(['.ts', '.js', '.svelte', '.json', '.env', '.yaml', '.yml', '.toml']);

const findings: { file: string; line: number; pattern: string }[] = [];

function scanDir(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '.git') continue;
      scanDir(fullPath);
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      scanFile(fullPath);
    }
  }
}

function scanFile(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const { name, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(lines[i])) {
        findings.push({ file: filePath, line: i + 1, pattern: name });
      }
    }
  }
}

scanDir(pluginDir);

if (findings.length > 0) {
  console.error(`❌ Security scan found ${findings.length} potential secret(s):`);
  findings.forEach(f => console.error(`  ${f.file}:${f.line} — ${f.pattern}`));
  process.exit(1);
} else {
  console.log(`✅ Security scan clean: no secrets detected in ${pluginDir}`);
}
