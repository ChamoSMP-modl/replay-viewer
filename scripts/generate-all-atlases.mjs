#!/usr/bin/env node
/**
 * Multi-version Atlas Generation
 *
 * Generates texture atlases for multiple Minecraft versions and writes a manifest.
 *
 * Usage: node scripts/generate-all-atlases.mjs
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VERSIONS = ['1.8.8', '1.12.2', '1.16.5', '1.19.4', '1.20.2', '1.21.1', '1.21.4', '1.21.11'];
const DEFAULT_VERSION = '1.21.11';

const scriptPath = path.join(__dirname, 'generate-atlas.mjs');

for (const version of VERSIONS) {
  console.log(`\n=== Generating atlas for ${version} ===\n`);
  execFileSync('node', [scriptPath, version], { stdio: 'inherit' });
}

// Write versions manifest
const manifest = {
  versions: VERSIONS,
  default: DEFAULT_VERSION,
};

const manifestPath = path.resolve(__dirname, '../public/atlas/versions.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nWritten manifest: ${manifestPath}`);
console.log('All atlases generated!');
