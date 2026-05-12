#!/usr/bin/env node
/**
 * Atlas Generation Script
 *
 * Generates a texture atlas (atlas.png) and mapping file (atlas-data.json)
 * from minecraft-assets and minecraft-data for block and item rendering.
 *
 * Usage: node scripts/generate-atlas.mjs [version]
 * Default version: 1.21.4
 */

import mcAssetsLoader from 'minecraft-assets';
import mcDataLoader from 'minecraft-data';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MC_VERSION = process.argv[2] || '1.21.4';
const TILE_SIZE = 16;

const mcAssets = mcAssetsLoader(MC_VERSION);
const mcData = mcDataLoader(MC_VERSION);

// ---------------------------------------------------------------------------
// Step 0: Download missing textures from Mojang client jar
// ---------------------------------------------------------------------------

/**
 * minecraft-assets may lag behind minecraft-data for newer MC versions.
 * When item textures are missing, download them from the official Mojang client jar.
 */
async function downloadMissingTextures(itemsDir, existingItems) {
  // Determine which items from minecraft-data are missing textures
  const existingSet = new Set(existingItems.map(f => f.replace('.png', '')));
  const missingItems = mcData.itemsArray
    .filter(item => !mcData.blocksByName[item.name]) // non-block items only
    .filter(item => !existingSet.has(item.name));

  if (missingItems.length === 0) return { entries: [], clientBlocksDir: null };

  // Fetch version manifest to find client jar URL
  let manifestResp;
  try {
    manifestResp = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    console.warn(`Could not fetch Mojang manifest (${e.cause?.code || e.message}), skipping ${missingItems.length} missing textures`);
    return { entries: [], clientBlocksDir: null };
  }
  const manifest = await manifestResp.json();
  const versionEntry = manifest.versions.find(v => v.id === MC_VERSION);
  if (!versionEntry) {
    console.warn(`MC version ${MC_VERSION} not found in Mojang manifest, skipping client jar download`);
    return { entries: [], clientBlocksDir: null };
  }

  const versionResp = await fetch(versionEntry.url);
  const versionData = await versionResp.json();
  const clientUrl = versionData.downloads.client.url;

  // Download client jar to temp dir
  const tmpDir = path.join(os.tmpdir(), `mc-atlas-${MC_VERSION}`);
  const jarPath = path.join(tmpDir, 'client.jar');
  fs.mkdirSync(tmpDir, { recursive: true });

  if (!fs.existsSync(jarPath)) {
    console.log(`Downloading Minecraft ${MC_VERSION} client jar...`);
    execSync(`curl -s -o "${jarPath}" "${clientUrl}"`, { timeout: 120000 });
  }

  // Extract item textures (pre-1.13 uses "items/", 1.13+ uses "item/")
  try {
    execSync(`unzip -qo "${jarPath}" "assets/minecraft/textures/item/*" -d "${tmpDir}"`, { timeout: 30000 });
  } catch { /* may not exist in older versions */ }
  try {
    execSync(`unzip -qo "${jarPath}" "assets/minecraft/textures/items/*" -d "${tmpDir}"`, { timeout: 30000 });
  } catch { /* may not exist in newer versions */ }
  const clientItemsDir = fs.existsSync(path.join(tmpDir, 'assets/minecraft/textures/item'))
    ? path.join(tmpDir, 'assets/minecraft/textures/item')
    : path.join(tmpDir, 'assets/minecraft/textures/items');

  // Also extract block textures in case some are missing (pre-1.13 uses "blocks/", 1.13+ uses "block/")
  try {
    execSync(`unzip -qo "${jarPath}" "assets/minecraft/textures/block/*" -d "${tmpDir}"`, { timeout: 30000 });
  } catch { /* may not exist in older versions */ }
  try {
    execSync(`unzip -qo "${jarPath}" "assets/minecraft/textures/blocks/*" -d "${tmpDir}"`, { timeout: 30000 });
  } catch { /* may not exist in newer versions */ }
  const clientBlocksDir = fs.existsSync(path.join(tmpDir, 'assets/minecraft/textures/block'))
    ? path.join(tmpDir, 'assets/minecraft/textures/block')
    : path.join(tmpDir, 'assets/minecraft/textures/blocks');

  // Copy missing item textures to a supplemental dir
  const supplemented = [];
  const supplementDir = path.join(tmpDir, 'supplemental-items');
  fs.mkdirSync(supplementDir, { recursive: true });

  for (const item of missingItems) {
    const clientFile = path.join(clientItemsDir, `${item.name}.png`);
    if (fs.existsSync(clientFile)) {
      const destFile = path.join(supplementDir, `${item.name}.png`);
      fs.copyFileSync(clientFile, destFile);
      supplemented.push(`${item.name}.png`);
    }
  }

  if (supplemented.length > 0) {
    console.log(`Supplemented ${supplemented.length} missing item textures from Mojang client jar`);
  }

  return {
    entries: supplemented.map(f => ({ name: `item/${f.replace('.png', '')}`, filePath: path.join(supplementDir, f) })),
    clientBlocksDir,
  };
}

// ---------------------------------------------------------------------------
// Step 0b: Extract entity textures from Mojang client jar
// ---------------------------------------------------------------------------

/**
 * Extract mob/entity textures from the Mojang client jar.
 * Saves them to <atlasDir>/entities/ and returns a mapping of entityType → relative path.
 */
async function extractEntityTextures(atlasDir) {
  const tmpDir = path.join(os.tmpdir(), `mc-atlas-${MC_VERSION}`);
  const jarPath = path.join(tmpDir, 'client.jar');

  if (!fs.existsSync(jarPath)) {
    console.warn('Client jar not found, skipping entity texture extraction');
    return {};
  }

  // Extract entity textures from jar
  try {
    execSync(`unzip -qo "${jarPath}" "assets/minecraft/textures/entity/*" -d "${tmpDir}" 2>/dev/null || true`, { timeout: 30000 });
  } catch (e) {
    console.warn('Failed to extract entity textures from client jar');
    return {};
  }

  const entitySrcDir = path.join(tmpDir, 'assets/minecraft/textures/entity');
  if (!fs.existsSync(entitySrcDir)) return {};

  const entityDestDir = path.join(atlasDir, 'entities');
  fs.mkdirSync(entityDestDir, { recursive: true });

  // Entity type → texture file path in client jar
  // Humanoid mobs use the same 64×64 UV layout as player skins
  const ENTITY_TEXTURE_PATHS = {
    // Humanoid mobs (64×64, same UV layout as player skins)
    zombie:            'zombie/zombie.png',
    skeleton:          'skeleton/skeleton.png',
    creeper:           'creeper/creeper.png',
    enderman:          'enderman/enderman.png',
    blaze:             'blaze.png',
    witch:             'witch.png',
    villager:          'villager/villager.png',
    zombie_villager:   'zombie_villager/zombie_villager.png',
    pillager:          'illager/pillager.png',
    vindicator:        'illager/vindicator.png',
    evoker:            'illager/evoker.png',
    drowned:           'zombie/drowned.png',
    husk:              'zombie/husk.png',
    stray:             'skeleton/stray.png',
    wither_skeleton:   'skeleton/wither_skeleton.png',
    piglin:            'piglin/piglin.png',
    piglin_brute:      'piglin/piglin_brute.png',
    zombified_piglin:  'piglin/zombified_piglin.png',
    wandering_trader:  'wandering_trader.png',
    vex:               'illager/vex.png',
    // Non-humanoid mobs
    spider:            'spider/spider.png',
    cave_spider:       'spider/cave_spider.png',
    slime:             'slime/slime.png',
    magma_cube:        'slime/magmacube.png',
    phantom:           'phantom.png',
    iron_golem:        'iron_golem/iron_golem.png',
    wolf:              'wolf/wolf.png',
    cat:               'cat/tabby.png',
    ocelot:            'cat/ocelot.png',
    cow:               'cow/cow.png',
    mooshroom:         'cow/red_mooshroom.png',
    pig:               'pig/pig.png',
    sheep:             'sheep/sheep.png',
    chicken:           'chicken.png',
    horse:             'horse/horse_brown.png',
    zombie_horse:      'horse/horse_zombie.png',
    skeleton_horse:    'horse/horse_skeleton.png',
    donkey:            'horse/donkey.png',
    mule:              'horse/mule.png',
    llama:             'llama/brown.png',
    trader_llama:      'llama/brown.png',
    turtle:            'turtle/big_sea_turtle.png',
    rabbit:            'rabbit/brown.png',
    fox:               'fox/fox.png',
    bee:               'bee/bee.png',
    goat:              'goat/goat.png',
    frog:              'frog/temperate_frog.png',
    panda:             'panda/panda.png',
    polar_bear:        'bear/polarbear.png',
    bat:               'bat.png',
    squid:             'squid/squid.png',
    glow_squid:        'squid/glow_squid.png',
    dolphin:           'dolphin.png',
    guardian:           'guardian.png',
    elder_guardian:     'guardian_elder.png',
    ghast:             'ghast/ghast.png',
    warden:            'warden/warden.png',
    ravager:           'illager/ravager.png',
    hoglin:            'hoglin/hoglin.png',
    zoglin:            'hoglin/zoglin.png',
    wither:            'wither/wither.png',
    silverfish:        'silverfish.png',
    endermite:         'endermite.png',
    shulker:           'shulker/shulker.png',
    allay:             'allay/allay.png',
    breeze:            'breeze/breeze.png',
    bogged:            'skeleton/bogged.png',
    snow_golem:        'snow_golem.png',
    strider:           'strider/strider.png',
    axolotl:           'axolotl/axolotl_lucy.png',
    camel:             'camel/camel.png',
    sniffer:           'sniffer/sniffer.png',
    armadillo:         'armadillo.png',
    creaking:          'creaking/creaking.png',
  };

  const entityTextures = {};
  let copiedCount = 0;

  for (const [entityType, texPath] of Object.entries(ENTITY_TEXTURE_PATHS)) {
    const srcFile = path.join(entitySrcDir, texPath);
    if (fs.existsSync(srcFile)) {
      const destFile = path.join(entityDestDir, `${entityType}.png`);
      fs.copyFileSync(srcFile, destFile);
      entityTextures[entityType] = `entities/${entityType}.png`;
      copiedCount++;
    }
  }

  console.log(`Extracted ${copiedCount} entity textures (${Object.keys(entityTextures).length} types)`);
  return entityTextures;
}

// ---------------------------------------------------------------------------
// Step 0c: Extract armor textures from Mojang client jar
// ---------------------------------------------------------------------------

/**
 * Extract armor layer PNG textures from the Mojang client jar.
 * These are at assets/minecraft/textures/models/armor/ in the jar.
 * Saves them to <atlasDir>/armor/ and returns a mapping.
 */
async function extractArmorTextures(atlasDir) {
  const tmpDir = path.join(os.tmpdir(), `mc-atlas-${MC_VERSION}`);
  const jarPath = path.join(tmpDir, 'client.jar');

  // Download jar if not already downloaded (may already exist from downloadMissingTextures)
  if (!fs.existsSync(jarPath)) {
    let manifestResp;
    try {
      manifestResp = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { signal: AbortSignal.timeout(15000) });
    } catch (e) {
      console.warn(`Could not fetch Mojang manifest for armor textures: ${e.message}`);
      return {};
    }
    const manifest = await manifestResp.json();
    const versionEntry = manifest.versions.find(v => v.id === MC_VERSION);
    if (!versionEntry) return {};

    const versionResp = await fetch(versionEntry.url);
    const versionData = await versionResp.json();
    const clientUrl = versionData.downloads.client.url;

    fs.mkdirSync(tmpDir, { recursive: true });
    console.log(`Downloading Minecraft ${MC_VERSION} client jar for armor textures...`);
    execSync(`curl -s -o "${jarPath}" "${clientUrl}"`, { timeout: 120000 });
  }

  // Extract armor textures from jar — try both old and new paths
  // Pre-1.21.4: assets/minecraft/textures/models/armor/<mat>_layer_1.png
  // 1.21.4+:    assets/minecraft/textures/entity/equipment/humanoid/<mat>.png (layer1)
  //             assets/minecraft/textures/entity/equipment/humanoid_leggings/<mat>.png (layer2)
  const oldArmorDir = path.join(tmpDir, 'assets/minecraft/textures/models/armor');
  const newHumanoidDir = path.join(tmpDir, 'assets/minecraft/textures/entity/equipment/humanoid');
  const newLeggingsDir = path.join(tmpDir, 'assets/minecraft/textures/entity/equipment/humanoid_leggings');

  try {
    execSync(`unzip -qo "${jarPath}" "assets/minecraft/textures/models/armor/*" -d "${tmpDir}" 2>/dev/null || true`, { timeout: 30000 });
    execSync(`unzip -qo "${jarPath}" "assets/minecraft/textures/entity/equipment/humanoid/*" -d "${tmpDir}" 2>/dev/null || true`, { timeout: 30000 });
    execSync(`unzip -qo "${jarPath}" "assets/minecraft/textures/entity/equipment/humanoid_leggings/*" -d "${tmpDir}" 2>/dev/null || true`, { timeout: 30000 });
  } catch (e) {
    console.warn('Failed to extract armor textures from client jar');
    return {};
  }

  const armorDestDir = path.join(atlasDir, 'armor');
  fs.mkdirSync(armorDestDir, { recursive: true });

  const MATERIALS = ['diamond', 'iron', 'gold', 'netherite', 'leather', 'chainmail', 'turtle'];
  // Material name in new format (1.21.4+): turtle → turtle_scute
  const NEW_FORMAT_NAMES = { turtle: 'turtle_scute' };
  const armorTextures = {};
  let copiedCount = 0;

  for (const mat of MATERIALS) {
    const entry = {};

    // Try old format first: <mat>_layer_1.png / <mat>_layer_2.png
    const oldL1 = path.join(oldArmorDir, `${mat}_layer_1.png`);
    const oldL2 = path.join(oldArmorDir, `${mat}_layer_2.png`);
    if (fs.existsSync(oldL1)) {
      const dest = `${mat}_layer_1.png`;
      fs.copyFileSync(oldL1, path.join(armorDestDir, dest));
      entry.layer1 = `armor/${dest}`;
      copiedCount++;
    }
    if (fs.existsSync(oldL2)) {
      const dest = `${mat}_layer_2.png`;
      fs.copyFileSync(oldL2, path.join(armorDestDir, dest));
      entry.layer2 = `armor/${dest}`;
      copiedCount++;
    }

    // Try new format (1.21.4+): humanoid/<mat>.png, humanoid_leggings/<mat>.png
    if (!entry.layer1) {
      const newName = NEW_FORMAT_NAMES[mat] || mat;
      const newL1 = path.join(newHumanoidDir, `${newName}.png`);
      if (fs.existsSync(newL1)) {
        const dest = `${mat}_layer_1.png`;
        fs.copyFileSync(newL1, path.join(armorDestDir, dest));
        entry.layer1 = `armor/${dest}`;
        copiedCount++;
      }
    }
    if (!entry.layer2) {
      const newName = NEW_FORMAT_NAMES[mat] || mat;
      const newL2 = path.join(newLeggingsDir, `${newName}.png`);
      if (fs.existsSync(newL2)) {
        const dest = `${mat}_layer_2.png`;
        fs.copyFileSync(newL2, path.join(armorDestDir, dest));
        entry.layer2 = `armor/${dest}`;
        copiedCount++;
      }
    }

    if (Object.keys(entry).length > 0) armorTextures[mat] = entry;
  }

  console.log(`Extracted ${copiedCount} armor textures (${Object.keys(armorTextures).length} materials)`);
  return armorTextures;
}

// ---------------------------------------------------------------------------
// Step 1: Collect all unique block + item texture PNGs
// ---------------------------------------------------------------------------

const blocksDir = path.join(mcAssets.directory, 'blocks');
const blockPngFiles = fs.readdirSync(blocksDir).filter(f => f.endsWith('.png'));

// Collect item textures
const itemsDir = path.join(mcAssets.directory, 'items');
let itemPngFiles = [];
if (fs.existsSync(itemsDir)) {
  itemPngFiles = fs.readdirSync(itemsDir).filter(f => f.endsWith('.png'));
}

// Build combined texture list: block textures first, then item/ prefixed textures
const allTextureEntries = []; // { name, filePath }
for (const f of blockPngFiles) {
  allTextureEntries.push({ name: f.replace('.png', ''), filePath: path.join(blocksDir, f) });
}
for (const f of itemPngFiles) {
  allTextureEntries.push({ name: `item/${f.replace('.png', '')}`, filePath: path.join(itemsDir, f) });
}

// Supplement missing item textures from Mojang client jar
const { entries: supplementalEntries, clientBlocksDir } = await downloadMissingTextures(itemsDir, itemPngFiles);
for (const entry of supplementalEntries) {
  if (!allTextureEntries.some(e => e.name === entry.name)) {
    allTextureEntries.push(entry);
  }
}

// Save clientBlocksDir for deferred block texture supplementation (done after model resolution)
const _clientBlocksDir = clientBlocksDir;

// Map texture short name → index in atlas
const textureNames = allTextureEntries.map(e => e.name);
const textureIndex = new Map(); // name → grid index
textureNames.forEach((name, i) => textureIndex.set(name, i));

const textureCount = textureNames.length;
const gridSize = Math.ceil(Math.sqrt(textureCount));
const atlasSize = gridSize * TILE_SIZE;

console.log(`Block textures: ${blockPngFiles.length}, Item textures: ${itemPngFiles.length + supplementalEntries.length}`);
console.log(`Total: ${textureCount}, Grid: ${gridSize}x${gridSize}, Atlas: ${atlasSize}x${atlasSize}`);

// ---------------------------------------------------------------------------
// Step 2: Pack textures into atlas image
// ---------------------------------------------------------------------------

// Minecraft plains biome tint colors
const GRASS_TINT = { r: 0x91, g: 0xBD, b: 0x59 };
const FOLIAGE_TINT = { r: 0x77, g: 0xAB, b: 0x2F };
const SPRUCE_TINT = { r: 0x61, g: 0x99, b: 0x61 };
const BIRCH_TINT = { r: 0x80, g: 0xA7, b: 0x55 };
const WATER_TINT = { r: 0x3F, g: 0x76, b: 0xE4 };

// Textures that need biome tinting (grayscale → colored)
const GRASS_TINTED = new Set([
  'grass_block_top', 'grass_block_side_overlay',
  'short_grass', 'tall_grass_top', 'tall_grass_bottom',
  'fern', 'large_fern_top', 'large_fern_bottom',
  'sugar_cane',
  // Pre-1.13 texture names
  'grass_top', 'grass_side_overlay', 'tallgrass',
  'double_plant_grass_top', 'double_plant_grass_bottom',
  'double_plant_fern_top', 'double_plant_fern_bottom',
]);
const FOLIAGE_TINTED = new Set([
  'oak_leaves', 'jungle_leaves', 'acacia_leaves',
  'dark_oak_leaves', 'mangrove_leaves', 'pale_oak_leaves',
  'azalea_leaves', 'flowering_azalea_leaves',
  'bamboo_large_leaves', 'bamboo_small_leaves',
  'vine', 'lily_pad',
  // Pre-1.13 texture names
  'leaves_oak', 'leaves_jungle', 'leaves_acacia', 'leaves_big_oak',
  'waterlily',
]);
const SPRUCE_TINTED = new Set(['spruce_leaves', 'leaves_spruce']);
const BIRCH_TINTED = new Set(['birch_leaves', 'leaves_birch']);
const WATER_TINTED = new Set(['water_still', 'water_flow']);

// Leaf textures: force fully opaque (Minecraft "fast" graphics style)
const FORCE_OPAQUE = new Set([
  'oak_leaves', 'spruce_leaves', 'birch_leaves', 'jungle_leaves',
  'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'pale_oak_leaves',
  'azalea_leaves', 'flowering_azalea_leaves', 'cherry_leaves',
  'bamboo_large_leaves', 'bamboo_small_leaves',
  // Pre-1.13 texture names
  'leaves_oak', 'leaves_spruce', 'leaves_birch', 'leaves_jungle',
  'leaves_acacia', 'leaves_big_oak',
]);

function getTint(texName) {
  if (GRASS_TINTED.has(texName)) return GRASS_TINT;
  if (FOLIAGE_TINTED.has(texName)) return FOLIAGE_TINT;
  if (SPRUCE_TINTED.has(texName)) return SPRUCE_TINT;
  if (BIRCH_TINTED.has(texName)) return BIRCH_TINT;
  if (WATER_TINTED.has(texName)) return WATER_TINT;
  return null;
}

/**
 * Process raw RGBA pixel data: apply tint color, force opaque, boost water alpha.
 */
function processPixels(rawBuffer, { tint, isWater, forceOpaque }) {
  const out = Buffer.from(rawBuffer);
  for (let i = 0; i < out.length; i += 4) {
    if (tint) {
      out[i]     = Math.round(out[i]     * tint.r / 255);
      out[i + 1] = Math.round(out[i + 1] * tint.g / 255);
      out[i + 2] = Math.round(out[i + 2] * tint.b / 255);
    }
    if (isWater) {
      out[i + 3] = Math.min(255, Math.max(out[i + 3], 160));
    }
    if (forceOpaque && out[i + 3] > 0) {
      // Make non-fully-transparent pixels fully opaque
      out[i + 3] = 255;
    }
  }
  return out;
}

async function buildAtlas(count, grid, size) {
  const _tc = count || textureCount;
  const _gs = grid || gridSize;
  const _as = size || atlasSize;
  const composites = [];

  for (let i = 0; i < _tc; i++) {
    const col = i % _gs;
    const row = Math.floor(i / _gs);
    const filePath = allTextureEntries[i].filePath;
    const texName = allTextureEntries[i].name;

    let img = sharp(filePath);
    const meta = await img.metadata();

    // Animated textures: extract first frame (height > width means spritesheet)
    if (meta.height > meta.width) {
      img = img.extract({ left: 0, top: 0, width: meta.width, height: meta.width });
    }

    // Ensure RGBA
    img = img.ensureAlpha();

    // Resize to tile size
    img = img.resize(TILE_SIZE, TILE_SIZE, { kernel: sharp.kernel.nearest });

    const tint = getTint(texName);
    const forceOpaque = FORCE_OPAQUE.has(texName);
    const isWater = WATER_TINTED.has(texName);
    let buf;
    if (tint || forceOpaque || isWater) {
      const raw = await img.raw().toBuffer();
      const processed = processPixels(raw, { tint, isWater, forceOpaque });
      buf = await sharp(processed, { raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 4 } })
        .png()
        .toBuffer();
    } else {
      buf = await img.png().toBuffer();
    }

    composites.push({
      input: buf,
      left: col * TILE_SIZE,
      top: row * TILE_SIZE,
    });
  }

  const atlasDir = path.resolve(__dirname, `../public/atlas/${MC_VERSION}`);
  fs.mkdirSync(atlasDir, { recursive: true });
  const atlasPath = path.join(atlasDir, 'atlas.png');
  await sharp({
    create: {
      width: _as,
      height: _as,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png().toFile(atlasPath);
  console.log(`Written: ${atlasPath}`);
}

// ---------------------------------------------------------------------------
// Step 3: Build UV lookup for each texture name
// ---------------------------------------------------------------------------

function buildTextureUVs(grid) {
  const _gs = grid || gridSize;
  const _tc = textureNames.length;
  const textures = {};
  for (let i = 0; i < _tc; i++) {
    const col = i % _gs;
    const row = Math.floor(i / _gs);
    textures[textureNames[i]] = {
      u: col / _gs,
      v: row / _gs,
      su: 1 / _gs,
      sv: 1 / _gs,
    };
  }
  return textures;
}

// ---------------------------------------------------------------------------
// Step 4: Resolve block models → per-face texture names
// ---------------------------------------------------------------------------

const models = mcAssets.blocksModels;
const blockStates = mcAssets.blocksStates;

/**
 * Resolve texture variables in a model by following the parent chain.
 * Returns a flat map of resolved texture references (e.g. { all: "stone", top: "oak_log_top" }).
 */
function resolveModelTextures(modelName) {
  const visited = new Set();
  const textures = {};

  let current = modelName;
  while (current && !visited.has(current)) {
    visited.add(current);
    // Normalize: "minecraft:block/stone" → "stone"
    const key = current
      .replace('minecraft:block/', '')
      .replace('block/', '');

    const model = models[key];
    if (!model) break;

    // Merge textures (child overrides parent, so only set if not already set)
    if (model.textures) {
      for (const [varName, ref] of Object.entries(model.textures)) {
        if (!textures[varName]) {
          textures[varName] = ref;
        }
      }
    }

    current = model.parent || null;
  }

  // Now resolve variable references (#all, #side, etc.)
  const resolved = {};
  for (const [varName, ref] of Object.entries(textures)) {
    resolved[varName] = resolveRef(ref, textures);
  }
  return resolved;
}

/**
 * Resolve a texture reference like "#all" or "minecraft:block/stone" to a short name.
 */
function resolveRef(ref, textures, depth = 0) {
  if (depth > 10) return ref; // prevent infinite loops
  if (ref.startsWith('#')) {
    const varName = ref.slice(1);
    if (textures[varName]) {
      return resolveRef(textures[varName], textures, depth + 1);
    }
    return ref;
  }
  // "minecraft:block/stone" → "stone", "blocks/stone" → "stone" (1.8 uses "blocks/" prefix)
  return ref
    .replace('minecraft:block/', '')
    .replace('minecraft:blocks/', '')
    .replace('blocks/', '')
    .replace('block/', '');
}

/**
 * Check if a block uses a "cross" or "tinted_cross" model (e.g. flowers, sugarcane).
 * Walks the model parent chain looking for cross parent.
 */
/**
 * Blocks that are flat overlays rendered as a horizontal floor quad.
 */
const FLOOR_BLOCK_KEYWORDS = [
  'lily_pad', 'waterlily', // waterlily = pre-1.13 lily_pad
  'snow', 'carpet', 'moss_carpet',
  'redstone_wire', 'tripwire',
  // Flat / low-profile blocks
  'button', 'pressure_plate',
  'repeater', 'comparator',
];

/**
 * Blocks that are thin vegetation or otherwise non-cube shapes
 * that should NOT render as full cubes. Rendered as cross-model (X-shape) instead.
 */
const NON_CUBE_KEYWORDS = [
  // Flat overlays (attach to surfaces) — rendered as floor
  ...FLOOR_BLOCK_KEYWORDS,
  // Surface-hugging overlays — render as cross (simplified, since multipart not supported)
  'glow_lichen', 'sculk_vein',
  // Vine-like
  'vine',
  // Pre-1.13 names (models define cross geometry inline, not via cross parent)
  'tallgrass', 'reeds',
  // Thin / flat vegetation
  'hanging_roots', 'nether_sprouts', 'spore_blossom',
  'cave_vines', 'twisting_vines', 'weeping_vines',
  // Torches (standing + wall)
  'torch', 'soul_torch', 'redstone_torch',
  'wall_torch', 'soul_wall_torch', 'redstone_wall_torch',
  // Lanterns, chains, levers
  'lantern', 'soul_lantern',
  'chain',
  'lever',
  // Flower pots
  'flower_pot',
  // Other non-cube blocks
  'cobweb', 'ladder', 'rail', 'powered_rail', 'detector_rail', 'activator_rail',
];

function isFloorModel(blockName) {
  return FLOOR_BLOCK_KEYWORDS.some(kw => blockName.includes(kw));
}

function isCrossModel(blockName) {
  // Check hardcoded non-cube blocks first
  if (NON_CUBE_KEYWORDS.some(kw => blockName.includes(kw))) return true;

  let modelRef = null;
  const states = blockStates[blockName];
  if (states?.variants) {
    const defaultKey = '' in states.variants ? '' : Object.keys(states.variants)[0];
    const variant = states.variants[defaultKey];
    if (Array.isArray(variant)) {
      modelRef = variant[0]?.model;
    } else if (variant) {
      modelRef = variant.model;
    }
  } else if (states?.multipart) {
    for (const part of states.multipart) {
      const apply = part.apply;
      if (apply) {
        modelRef = Array.isArray(apply) ? apply[0]?.model : apply.model;
        if (modelRef) break;
      }
    }
  }
  if (!modelRef) modelRef = `minecraft:block/${blockName}`;

  // Walk parent chain looking for "cross" or "tinted_cross"
  const visited = new Set();
  let current = modelRef;
  while (current && !visited.has(current)) {
    visited.add(current);
    const key = current.replace('minecraft:block/', '').replace('block/', '');
    if (key === 'cross' || key === 'tinted_cross') return true;
    const model = models[key];
    if (!model) break;
    current = model.parent || null;
  }
  return false;
}

/**
 * For a given block name, resolve to { top, side, bottom } texture names.
 */
function resolveBlockFaces(blockName) {
  // Get model from block states (use first/default variant)
  let modelRef = null;

  const states = blockStates[blockName];
  if (states?.variants) {
    // Get default variant (empty string key or first key)
    const defaultKey = '' in states.variants ? '' : Object.keys(states.variants)[0];
    const variant = states.variants[defaultKey];
    if (Array.isArray(variant)) {
      modelRef = variant[0]?.model;
    } else if (variant) {
      modelRef = variant.model;
    }
  } else if (states?.multipart) {
    // Multipart: use first applicable model
    for (const part of states.multipart) {
      const apply = part.apply;
      if (apply) {
        modelRef = Array.isArray(apply) ? apply[0]?.model : apply.model;
        if (modelRef) break;
      }
    }
  }

  if (!modelRef) {
    // Try direct model lookup
    modelRef = `minecraft:block/${blockName}`;
  }

  const textures = resolveModelTextures(modelRef);

  // Determine per-face textures
  // Priority: explicit face names > common patterns > particle (water/lava etc.)
  const top = findTexture(textures, ['up', 'top', 'end', 'all', 'particle']) || blockName;
  const bottom = findTexture(textures, ['down', 'bottom', 'end', 'all', 'particle']) || blockName;
  const side = findTexture(textures, ['north', 'side', 'front', 'all', 'particle']) || blockName;

  return { top, side, bottom };
}

function findTexture(textures, keys) {
  for (const key of keys) {
    const val = textures[key];
    if (val && !val.startsWith('#')) return val;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Step 5: Map every stateId → block name → face textures
// ---------------------------------------------------------------------------

function buildBlockMapping(textureUVs) {
  const blocks = {};
  const missingTexture = textureNames[0] || 'stone'; // fallback

  for (const block of mcData.blocksArray) {
    if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') continue;

    const faces = resolveBlockFaces(block.name);

    // Validate that textures exist in atlas; fall back if not
    const validTop = textureIndex.has(faces.top) ? faces.top : missingTexture;
    const validSide = textureIndex.has(faces.side) ? faces.side : missingTexture;
    const validBottom = textureIndex.has(faces.bottom) ? faces.bottom : missingTexture;

    // Check if block uses cross or floor model
    const floor = isFloorModel(block.name);
    const cross = !floor && isCrossModel(block.name);

    // Write entry for every state ID this block has
    for (let sid = block.minStateId; sid <= block.maxStateId; sid++) {
      const entry = {
        top: validTop,
        side: validSide,
        bottom: validBottom,
      };
      if (floor) entry.shape = 'floor';
      else if (cross) entry.shape = 'cross';
      blocks[sid] = entry;
    }
  }

  // Override multiface blocks with per-state face data
  const MULTIFACE_BLOCKS = ['glow_lichen', 'sculk_vein'];
  for (const blockName of MULTIFACE_BLOCKS) {
    const block = mcData.blocksByName[blockName];
    if (!block) continue;
    // Properties in order: down(bit6), east(bit5), north(bit4), south(bit3), up(bit2), waterlogged(bit1), west(bit0)
    for (let sid = block.minStateId; sid <= block.maxStateId; sid++) {
      const offset = sid - block.minStateId;
      // Encode active faces as 6-bit mask: up=1, down=2, north=4, south=8, east=16, west=32
      let faceMask = 0;
      if (offset & 4)  faceMask |= 1;   // up
      if (offset & 64) faceMask |= 2;   // down
      if (offset & 16) faceMask |= 4;   // north
      if (offset & 8)  faceMask |= 8;   // south
      if (offset & 32) faceMask |= 16;  // east
      if (offset & 1)  faceMask |= 32;  // west
      if (blocks[sid]) {
        blocks[sid].shape = 'multiface';
        blocks[sid].faceMask = faceMask;
      }
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Generating atlas for Minecraft ${MC_VERSION}...`);

  // Supplement missing block textures from Mojang client jar.
  // Scan block models to find referenced texture names that are missing from the atlas,
  // then add only those specific textures from the client jar.
  if (_clientBlocksDir && fs.existsSync(_clientBlocksDir)) {
    const referencedTextures = new Set();
    for (const block of mcData.blocksArray) {
      if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') continue;
      const faces = resolveBlockFaces(block.name);
      referencedTextures.add(faces.top);
      referencedTextures.add(faces.side);
      referencedTextures.add(faces.bottom);
    }
    let supplementedBlocks = 0;
    for (const texName of referencedTextures) {
      if (textureIndex.has(texName)) continue;
      const clientFile = path.join(_clientBlocksDir, `${texName}.png`);
      if (fs.existsSync(clientFile)) {
        allTextureEntries.push({ name: texName, filePath: clientFile });
        textureIndex.set(texName, allTextureEntries.length - 1);
        supplementedBlocks++;
      }
    }
    if (supplementedBlocks > 0) {
      // Rebuild textureNames and recalculate grid after supplementation
      textureNames.length = 0;
      textureNames.push(...allTextureEntries.map(e => e.name));
      textureIndex.clear();
      textureNames.forEach((name, i) => textureIndex.set(name, i));
      console.log(`Supplemented ${supplementedBlocks} missing block textures from Mojang client jar`);
    }
  }

  // Recalculate grid size in case block supplementation added textures
  const finalTextureCount = textureNames.length;
  const finalGridSize = Math.ceil(Math.sqrt(finalTextureCount));
  const finalAtlasSize = finalGridSize * TILE_SIZE;

  // Build atlas image
  await buildAtlas(finalTextureCount, finalGridSize, finalAtlasSize);

  // Build data
  const textureUVs = buildTextureUVs(finalGridSize);
  const blockMapping = buildBlockMapping(textureUVs);

  // Build set of transparent state IDs (blocks you can see through)
  const transparentStates = [];
  for (const block of mcData.blocksArray) {
    if (block.transparent) {
      for (let sid = block.minStateId; sid <= block.maxStateId; sid++) {
        transparentStates.push(sid);
      }
    }
  }
  console.log(`Transparent state IDs: ${transparentStates.length}`);

  // Build stateId → blockId mapping (for same-type transparent culling)
  const stateToBlock = {};
  for (const block of mcData.blocksArray) {
    for (let sid = block.minStateId; sid <= block.maxStateId; sid++) {
      stateToBlock[sid] = block.id;
    }
  }
  console.log(`State-to-block entries: ${Object.keys(stateToBlock).length}`);

  // Build water level heights per state ID
  const waterLevels = {};
  const waterBlock = mcData.blocksByName['water'];
  if (waterBlock) {
    for (let sid = waterBlock.minStateId; sid <= waterBlock.maxStateId; sid++) {
      const level = sid - waterBlock.minStateId;
      if (level === 0) waterLevels[sid] = 14/16;           // source
      else if (level <= 7) waterLevels[sid] = (8-level)/9 * (14/16); // flowing
      else waterLevels[sid] = 1.0;                          // falling
    }
  }
  console.log(`Water level entries: ${Object.keys(waterLevels).length}`);

  // Build blockName → default stateId mapping (for item→texture lookup)
  const blockNameToState = {};
  for (const block of mcData.blocksArray) {
    if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') continue;
    blockNameToState[block.name] = block.minStateId;
  }
  console.log(`Block name-to-state entries: ${Object.keys(blockNameToState).length}`);

  // Fallback texture mappings for items with animated/variant textures
  const ITEM_TEXTURE_FALLBACKS = {
    enchanted_golden_apple: 'item/golden_apple',
    crossbow: 'item/crossbow_standby',
    compass: 'item/compass_16',
    recovery_compass: 'item/recovery_compass_16',
    clock: 'item/clock_00',
    tipped_arrow: 'item/tipped_arrow_base',
    shield: 'item/shield_base_nopattern', // may not exist, but try
    debug_stick: 'item/stick',
  };

  // Build item mapping: itemName → { texture, isBlock }
  const items = {};
  for (const item of mcData.itemsArray) {
    const isBlock = !!mcData.blocksByName[item.name];
    if (isBlock) {
      // Block items use their block texture
      const faces = blockMapping[blockNameToState[item.name]];
      items[item.name] = { texture: faces ? faces.side : item.name, isBlock: true };
    } else {
      // Non-block items use item/ prefixed texture
      const itemTexName = `item/${item.name}`;
      if (textureIndex.has(itemTexName)) {
        items[item.name] = { texture: itemTexName, isBlock: false };
      } else if (ITEM_TEXTURE_FALLBACKS[item.name] && textureIndex.has(ITEM_TEXTURE_FALLBACKS[item.name])) {
        items[item.name] = { texture: ITEM_TEXTURE_FALLBACKS[item.name], isBlock: false };
      } else {
        // No texture found — will fall back to placeholder in renderer
        items[item.name] = { texture: null, isBlock: false };
      }
    }
  }
  const itemsWithTexture = Object.values(items).filter(i => i.texture !== null).length;
  console.log(`Item mapping entries: ${Object.keys(items).length} (${itemsWithTexture} with textures)`);

  const atlasDir = path.resolve(__dirname, `../public/atlas/${MC_VERSION}`);

  // Extract armor textures from Mojang client jar
  const armorTextures = await extractArmorTextures(atlasDir);

  // Extract entity textures from Mojang client jar
  const entityTextures = await extractEntityTextures(atlasDir);

  const atlasData = {
    textures: textureUVs,
    blocks: blockMapping,
    transparentStates,
    stateToBlock,
    waterLevels,
    blockNameToState,
    items,
    armorTextures,
    entityTextures,
  };

  const jsonPath = path.join(atlasDir, 'atlas-data.json');
  fs.writeFileSync(jsonPath, JSON.stringify(atlasData));
  console.log(`Written: ${jsonPath} (${Object.keys(blockMapping).length} state IDs mapped)`);

  // Also copy to test site public
  const testSitePublic = path.resolve(__dirname, '../../modl-replay-test-site/public');
  if (fs.existsSync(testSitePublic)) {
    fs.copyFileSync(
      path.join(atlasDir, 'atlas.png'),
      path.join(testSitePublic, 'atlas.png')
    );
    fs.copyFileSync(jsonPath, path.join(testSitePublic, 'atlas-data.json'));
    // Copy armor textures to test site
    const armorSrcDir = path.join(atlasDir, 'armor');
    if (fs.existsSync(armorSrcDir)) {
      const testArmorDir = path.join(testSitePublic, 'armor');
      fs.mkdirSync(testArmorDir, { recursive: true });
      for (const f of fs.readdirSync(armorSrcDir).filter(f => f.endsWith('.png'))) {
        fs.copyFileSync(path.join(armorSrcDir, f), path.join(testArmorDir, f));
      }
    }
    // Copy entity textures to test site
    const entitySrcDir = path.join(atlasDir, 'entities');
    if (fs.existsSync(entitySrcDir)) {
      const testEntityDir = path.join(testSitePublic, 'entities');
      fs.mkdirSync(testEntityDir, { recursive: true });
      for (const f of fs.readdirSync(entitySrcDir).filter(f => f.endsWith('.png'))) {
        fs.copyFileSync(path.join(entitySrcDir, f), path.join(testEntityDir, f));
      }
    }
    console.log(`Copied atlas files to test site public/`);
  }

  console.log('Done!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
