#!/usr/bin/env node
/**
 * Multi-version Atlas Generation
 *
 * Generates texture atlases for multiple Minecraft versions and writes a manifest.
 *
 * Usage: node scripts/generate-all-atlases.mjs
 */

import {execFileSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VERSIONS = ['1.21.11', '26.1.2', '26.2', '26.3'];
let DEFAULT_VERSION = '26.3';

const scriptPath = path.join(__dirname, 'generate-atlas.mjs');

for (const version of VERSIONS) {
    console.log(`\n=== Generating atlas for ${version} ===\n`);

    execFileSync('node', [scriptPath, version], {stdio: 'inherit'});
}

console.log("\nDefault version: " + DEFAULT_VERSION)
console.log("Versions: " + VERSIONS)

// Write versions manifest
const manifest = {
    versions: VERSIONS,
    default: DEFAULT_VERSION,
};

const manifestPath = path.resolve(__dirname, '../public/atlas/versions.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nWritten manifest: ${manifestPath}`);
console.log('All atlases generated!');
