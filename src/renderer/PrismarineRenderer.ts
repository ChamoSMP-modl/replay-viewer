import * as THREE from 'three';
import { BlockChange } from '../engine/WorldState';
import { BlockSnapshot } from '../types/ReplayFile';

/**
 * Atlas mapping data: maps texture names to UV coords and state IDs to face textures.
 */
export interface AtlasMapping {
  textures: Record<string, { u: number; v: number; su: number; sv: number }>;
  blocks: Record<number, { top: string; side: string; bottom: string; shape?: string; faceMask?: number }>;
  transparentStates?: number[];
  stateToBlock?: Record<number, number>;
  waterLevels?: Record<number, number>;
  blockNameToState?: Record<string, number>;
  items?: Record<string, { texture: string | null; isBlock: boolean }>;
  armorTextures?: Record<string, { layer1?: string; layer2?: string }>;
  entityTextures?: Record<string, string>;
}

// Face normals and vertex offsets for each of 6 faces
// Each face has 4 vertices (position offsets from block origin)
const FACE_DATA = {
  // +Y (top)
  up: {
    dir: [0, 1, 0],
    vertices: [
      [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1],
    ],
    normal: [0, 1, 0],
  },
  // -Y (bottom)
  down: {
    dir: [0, -1, 0],
    vertices: [
      [0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0],
    ],
    normal: [0, -1, 0],
  },
  // +X (east)
  east: {
    dir: [1, 0, 0],
    vertices: [
      [1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0],
    ],
    normal: [1, 0, 0],
  },
  // -X (west)
  west: {
    dir: [-1, 0, 0],
    vertices: [
      [0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1],
    ],
    normal: [-1, 0, 0],
  },
  // +Z (south)
  south: {
    dir: [0, 0, 1],
    vertices: [
      [0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1],
    ],
    normal: [0, 0, 1],
  },
  // -Z (north)
  north: {
    dir: [0, 0, -1],
    vertices: [
      [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0],
    ],
    normal: [0, 0, -1],
  },
} as const;

// UV coords for a face quad (maps to atlas sub-region)
const FACE_UVS: [number, number][] = [
  [0, 1], [0, 0], [1, 0], [1, 1],
];

// Two triangles for a quad (indices into the 4 vertices)
const QUAD_INDICES = [0, 2, 1, 0, 3, 2];

// Cross-model quads: two diagonals × 2 sides for double-faced rendering
// Diagonal 1: (0.1464,0,0.1464) → (0.8536,1,0.8536)
// Diagonal 2: (0.8536,0,0.1464) → (0.1464,1,0.8536)
const CROSS_QUADS: { vertices: [number, number, number][]; normal: [number, number, number] }[] = [
  // Diagonal 1 front
  { vertices: [[0.1464, 0, 0.8536], [0.1464, 1, 0.8536], [0.8536, 1, 0.1464], [0.8536, 0, 0.1464]], normal: [-0.7071, 0, 0.7071] },
  // Diagonal 1 back
  { vertices: [[0.8536, 0, 0.1464], [0.8536, 1, 0.1464], [0.1464, 1, 0.8536], [0.1464, 0, 0.8536]], normal: [0.7071, 0, -0.7071] },
  // Diagonal 2 front
  { vertices: [[0.1464, 0, 0.1464], [0.1464, 1, 0.1464], [0.8536, 1, 0.8536], [0.8536, 0, 0.8536]], normal: [0.7071, 0, 0.7071] },
  // Diagonal 2 back
  { vertices: [[0.8536, 0, 0.8536], [0.8536, 1, 0.8536], [0.1464, 1, 0.1464], [0.1464, 0, 0.1464]], normal: [-0.7071, 0, -0.7071] },
];

// Floor-model quads: flat horizontal quad rendered double-sided
const FLOOR_QUADS: { vertices: [number, number, number][]; normal: [number, number, number] }[] = [
  // Top face (visible from above)
  { vertices: [[0, 0.01, 0], [0, 0.01, 1], [1, 0.01, 1], [1, 0.01, 0]], normal: [0, 1, 0] },
  // Bottom face (visible from below)
  { vertices: [[1, 0.01, 0], [1, 0.01, 1], [0, 0.01, 1], [0, 0.01, 0]], normal: [0, -1, 0] },
];

// Multiface quads: thin face-aligned quads with 0.01 inset, double-sided
// faceMask bits: up=1, down=2, north=4, south=8, east=16, west=32
const MULTIFACE_FACES: { mask: number; quads: { vertices: [number, number, number][]; normal: [number, number, number] }[] }[] = [
  { mask: 1, quads: [ // up
    { vertices: [[0, 0.99, 0], [1, 0.99, 0], [1, 0.99, 1], [0, 0.99, 1]], normal: [0, 1, 0] },
    { vertices: [[0, 0.99, 1], [1, 0.99, 1], [1, 0.99, 0], [0, 0.99, 0]], normal: [0, -1, 0] },
  ]},
  { mask: 2, quads: [ // down
    { vertices: [[0, 0.01, 1], [1, 0.01, 1], [1, 0.01, 0], [0, 0.01, 0]], normal: [0, -1, 0] },
    { vertices: [[0, 0.01, 0], [1, 0.01, 0], [1, 0.01, 1], [0, 0.01, 1]], normal: [0, 1, 0] },
  ]},
  { mask: 4, quads: [ // north (-Z)
    { vertices: [[1, 0, 0.01], [1, 1, 0.01], [0, 1, 0.01], [0, 0, 0.01]], normal: [0, 0, -1] },
    { vertices: [[0, 0, 0.01], [0, 1, 0.01], [1, 1, 0.01], [1, 0, 0.01]], normal: [0, 0, 1] },
  ]},
  { mask: 8, quads: [ // south (+Z)
    { vertices: [[0, 0, 0.99], [0, 1, 0.99], [1, 1, 0.99], [1, 0, 0.99]], normal: [0, 0, 1] },
    { vertices: [[1, 0, 0.99], [1, 1, 0.99], [0, 1, 0.99], [0, 0, 0.99]], normal: [0, 0, -1] },
  ]},
  { mask: 16, quads: [ // east (+X)
    { vertices: [[0.99, 0, 1], [0.99, 1, 1], [0.99, 1, 0], [0.99, 0, 0]], normal: [1, 0, 0] },
    { vertices: [[0.99, 0, 0], [0.99, 1, 0], [0.99, 1, 1], [0.99, 0, 1]], normal: [-1, 0, 0] },
  ]},
  { mask: 32, quads: [ // west (-X)
    { vertices: [[0.01, 0, 0], [0.01, 1, 0], [0.01, 1, 1], [0.01, 0, 1]], normal: [-1, 0, 0] },
    { vertices: [[0.01, 0, 1], [0.01, 1, 1], [0.01, 1, 0], [0.01, 0, 0]], normal: [1, 0, 0] },
  ]},
];

type SectionKey = string; // "sx,sy,sz"

/**
 * Renderer interface abstracting over prismarine-viewer.
 * Supports atlas-based textured rendering with section-based mesh generation.
 */
export class PrismarineRenderer {
  private container: HTMLElement | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  private animationFrameId: number | null = null;

  private mcVersion: string;
  private initialized: boolean = false;

  // Atlas-based rendering
  private atlasTexture: THREE.Texture | null = null;
  private atlasMapping: AtlasMapping | null = null;
  private atlasMaterial: THREE.MeshLambertMaterial | null = null;
  private transparentAtlasMaterial: THREE.MeshLambertMaterial | null = null;
  private transparentStates: Set<number> = new Set();
  private stateToBlockId: Map<number, number> = new Map();
  private waterLevelMap: Map<number, number> = new Map();
  private blockNameToState: Map<string, number> = new Map();
  private itemMapping: Map<string, { texture: string | null; isBlock: boolean }> = new Map();
  // Runtime fallback texture mappings for items with animated/variant textures
  private static readonly ITEM_TEXTURE_FALLBACKS: Record<string, string> = {
    enchanted_golden_apple: 'item/golden_apple',
    crossbow: 'item/crossbow_standby',
    compass: 'item/compass_16',
    recovery_compass: 'item/recovery_compass_16',
    clock: 'item/clock_00',
    tipped_arrow: 'item/tipped_arrow_base',
    debug_stick: 'item/stick',
  };
  // States that should not render at all (barrier, structure_void, etc.)
  private hiddenStates: Set<number> = new Set();

  // Section-based mesh management
  private sections: Map<SectionKey, { opaque: THREE.Mesh | null; transparent: THREE.Mesh | null }> = new Map();
  private blockMap: Map<string, number> = new Map(); // "x,y,z" → stateId
  private dirtySections: Set<SectionKey> = new Set();

  // Skin textures cache
  private skinTextures: Map<string, THREE.Texture | null> = new Map();
  // Embedded skin PNG data from replay file
  private embeddedSkins: Map<string, Uint8Array> = new Map();

  // Armor texture cache: "material_layer1" or "material_layer2" → Texture
  private armorTextureCache: Map<string, THREE.Texture> = new Map();

  // Entity texture cache: entityType → Texture
  private entityTextureCache: Map<string, THREE.Texture> = new Map();

  // Walk cycle tracking
  private playerPrevPositions: Map<string, { x: number; z: number; time: number; moveDir: number }> = new Map();

  // Body yaw tracking for independent head rotation
  private playerBodyYaw: Map<string, number> = new Map();
  private _lastDebugLog: number = 0;

  // Held item tracking per player
  private playerHeldItems: Map<string, string> = new Map();

  constructor(mcVersion: string) {
    this.mcVersion = mcVersion;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 10000);
    this.camera.position.set(0, 80, 0);
  }

  /**
   * Set the texture atlas for block rendering.
   * Must be called before loadSnapshot() for textured rendering.
   */
  async setTextureAtlas(atlasUrl: string, mapping: AtlasMapping): Promise<void> {
    this.atlasMapping = mapping;
    if (mapping.transparentStates) {
      this.transparentStates = new Set(mapping.transparentStates);
    }
    if (mapping.stateToBlock) {
      this.stateToBlockId = new Map(
        Object.entries(mapping.stateToBlock).map(([k, v]) => [Number(k), v])
      );
    }

    const loader = new THREE.TextureLoader();
    this.atlasTexture = await new Promise<THREE.Texture>((resolve, reject) => {
      loader.load(atlasUrl, resolve, undefined, reject);
    });

    this.atlasTexture.magFilter = THREE.NearestFilter;
    this.atlasTexture.minFilter = THREE.NearestFilter;
    this.atlasTexture.colorSpace = THREE.SRGBColorSpace;
    this.atlasTexture.flipY = false;

    // Opaque material: no transparency, alpha test for cutout textures
    this.atlasMaterial = new THREE.MeshLambertMaterial({
      map: this.atlasTexture,
      transparent: false,
      alphaTest: 0.1,
    });

    // Transparent material: for water, glass, cross-model blocks etc.
    this.transparentAtlasMaterial = new THREE.MeshLambertMaterial({
      map: this.atlasTexture,
      transparent: true,
      depthWrite: false,
      alphaTest: 0.1,
    });

    // Block name to state map (for item rendering)
    if (mapping.blockNameToState) {
      this.blockNameToState = new Map(
        Object.entries(mapping.blockNameToState).map(([k, v]) => [k, v])
      );
    }

    // Hidden blocks (should not render)
    const HIDDEN_BLOCKS = ['barrier', 'structure_void', 'light'];
    for (const blockName of HIDDEN_BLOCKS) {
      const stateId = this.blockNameToState.get(blockName);
      if (stateId !== undefined) {
        this.hiddenStates.add(stateId);
        // Also hide all other states that share the same blockId
        const blockId = this.stateToBlockId.get(stateId);
        if (blockId !== undefined) {
          for (const [sid, bid] of this.stateToBlockId) {
            if (bid === blockId) this.hiddenStates.add(sid);
          }
        }
      }
    }

    // Item mapping
    if (mapping.items) {
      this.itemMapping = new Map(
        Object.entries(mapping.items).map(([k, v]) => [k, v])
      );
    }

    // Water level map
    if (mapping.waterLevels) {
      this.waterLevelMap = new Map(
        Object.entries(mapping.waterLevels).map(([k, v]) => [Number(k), v])
      );
    }

    // Load armor + entity textures in parallel (relative to atlas URL)
    const baseUrl = atlasUrl.substring(0, atlasUrl.lastIndexOf('/'));
    const texLoadPromises: Promise<void>[] = [];

    const loadTex = (url: string): Promise<THREE.Texture> =>
      new Promise<THREE.Texture>((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      }).then(tex => {
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = false;
        return tex;
      });

    if (mapping.armorTextures) {
      for (const [material, paths] of Object.entries(mapping.armorTextures)) {
        for (const [layerKey, relPath] of Object.entries(paths)) {
          texLoadPromises.push(
            loadTex(`${baseUrl}/${relPath}`)
              .then(tex => { this.armorTextureCache.set(`${material}_${layerKey}`, tex); })
              .catch(() => { /* skip missing */ })
          );
        }
      }
    }

    if (mapping.entityTextures) {
      for (const [entityType, relPath] of Object.entries(mapping.entityTextures)) {
        texLoadPromises.push(
          loadTex(`${baseUrl}/${relPath}`)
            .then(tex => { this.entityTextureCache.set(entityType, tex); })
            .catch(() => { /* skip missing */ })
        );
      }
    }

    await Promise.all(texLoadPromises);
  }

  /**
   * Initialize the renderer and attach to a DOM element.
   */
  async init(container: HTMLElement): Promise<void> {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x87ceeb); // sky blue
    this.updateSize();
    container.appendChild(this.renderer.domElement);

    this.setupBasicScene();
    this.initialized = true;
    this.startRenderLoop();
  }

  /**
   * Load the initial block snapshot into the renderer.
   */
  async loadSnapshot(blocks: BlockSnapshot[]): Promise<void> {
    console.log('[PrismarineRenderer] loadSnapshot called:', {
      initialized: this.initialized,
      hasAtlas: !!this.atlasMapping,
      blockCount: blocks.length,
    });
    if (!this.initialized) return;

    if (this.atlasMapping && this.atlasMaterial && this.transparentAtlasMaterial) {
      await this.loadBlocksTextured(blocks);
    } else {
      this.loadBlocksBasic(blocks);
    }
  }

  /**
   * Apply incremental block changes from the engine.
   */
  applyBlockChanges(changes: BlockChange[]): void {
    if (!this.initialized) return;

    if (this.atlasMapping && this.atlasMaterial && this.transparentAtlasMaterial) {
      for (const change of changes) {
        this.updateBlockTextured(change);
      }
      this.rebuildDirtySections();
    } else {
      for (const change of changes) {
        this.updateBlockBasic(change);
      }
    }
  }

  // Entity meshes: entityId → group
  private entityMeshes: Map<number, THREE.Group> = new Map();
  // Entity type names for explosion check
  private entityTypeNames: Map<number, string> = new Map();

  // Explosion particles
  private static readonly EXPLOSIVE_TYPES = new Set([
    'tnt', 'wind_charge', 'ender_crystal', 'end_crystal',
    'fireball', 'small_fireball', 'wither_skull', 'dragon_fireball',
  ]);
  private activeExplosions: Array<{
    particles: THREE.Points;
    velocities: Float32Array;
    startTime: number;
    duration: number;
    noGravity?: boolean;
    extraMeshes?: THREE.Object3D[];
  }> = [];

  // Entity type → atlas item name mapping for sprite rendering
  private static readonly ENTITY_ITEM_TEXTURES: Record<string, string> = {
    arrow: 'arrow',
    spectral_arrow: 'spectral_arrow',
    snowball: 'snowball',
    ender_pearl: 'ender_pearl',
    wind_charge: 'wind_charge',
    fire_charge: 'fire_charge',
    experience_bottle: 'experience_bottle',
    egg: 'egg',
    end_crystal: 'end_crystal',
    ender_crystal: 'end_crystal',
    fireball: 'fire_charge',
    small_fireball: 'fire_charge',
    wither_skull: 'wither_skeleton_skull',
    dragon_fireball: 'fire_charge',
    experience_orb: 'experience_bottle',
    trident: 'trident',
  };

  // Block entities that should render as textured cubes
  // Note: falling_block is handled separately with state ID metadata (falling_block:stateId)
  private static readonly ENTITY_BLOCK_NAMES: Record<string, string> = {
    tnt: 'tnt',
    primed_tnt: 'tnt',
  };

  // Humanoid mobs: render with head + body
  private static readonly HUMANOID_MOBS = new Set([
    'zombie', 'skeleton', 'creeper', 'enderman', 'blaze', 'witch',
    'villager', 'zombie_villager', 'pillager', 'vindicator', 'evoker',
    'drowned', 'husk', 'stray', 'wither_skeleton', 'piglin', 'piglin_brute',
    'zombified_piglin', 'armor_stand', 'wandering_trader', 'vex',
  ]);

  // Entity type → dimensions/color
  private static readonly ENTITY_STYLES: Record<string, { width: number; height: number; depth: number; color: number }> = {
    zombie:       { width: 0.6, height: 1.95, depth: 0.6, color: 0x00aa00 },
    skeleton:     { width: 0.6, height: 1.99, depth: 0.6, color: 0xc0c0c0 },
    creeper:      { width: 0.6, height: 1.7,  depth: 0.6, color: 0x00ff00 },
    spider:       { width: 1.4, height: 0.9,  depth: 1.4, color: 0x5c3a1e },
    enderman:     { width: 0.6, height: 2.9,  depth: 0.6, color: 0x161616 },
    blaze:        { width: 0.6, height: 1.8,  depth: 0.6, color: 0xff8800 },
    witch:        { width: 0.6, height: 1.95, depth: 0.6, color: 0x6a0dad },
    slime:        { width: 0.5, height: 0.5,  depth: 0.5, color: 0x88ff88 },
    phantom:      { width: 0.9, height: 0.5,  depth: 0.9, color: 0x4466aa },
    end_crystal:  { width: 2.0, height: 2.0,  depth: 2.0, color: 0xff00ff },
    ender_crystal: { width: 2.0, height: 2.0,  depth: 2.0, color: 0xff00ff },
    armor_stand:  { width: 0.5, height: 1.97, depth: 0.5, color: 0x8b6914 },
    item_frame:   { width: 0.5, height: 0.5,  depth: 0.1, color: 0xd2b48c },
    villager:     { width: 0.6, height: 1.95, depth: 0.6, color: 0xb37a4c },
    iron_golem:   { width: 1.4, height: 2.7,  depth: 1.4, color: 0xd4d4d4 },
    wolf:         { width: 0.6, height: 0.85, depth: 0.6, color: 0xd0d0d0 },
    cat:          { width: 0.6, height: 0.7,  depth: 0.6, color: 0xe8a020 },
    cow:          { width: 0.9, height: 1.4,  depth: 0.9, color: 0x443322 },
    pig:          { width: 0.9, height: 0.9,  depth: 0.9, color: 0xf0a0a0 },
    sheep:        { width: 0.9, height: 1.3,  depth: 0.9, color: 0xf0f0f0 },
    chicken:      { width: 0.4, height: 0.7,  depth: 0.4, color: 0xffffff },
    horse:        { width: 1.4, height: 1.6,  depth: 1.4, color: 0xc09060 },
    zombie_horse: { width: 1.4, height: 1.6,  depth: 1.4, color: 0x5a7a42 },
    skeleton_horse: { width: 1.4, height: 1.6, depth: 1.4, color: 0xc8c8a0 },
    donkey:       { width: 1.4, height: 1.5,  depth: 1.4, color: 0x5a4e3a },
    mule:         { width: 1.4, height: 1.6,  depth: 1.4, color: 0x5a3a20 },
    llama:        { width: 0.9, height: 1.87, depth: 0.9, color: 0xc0a888 },
    trader_llama: { width: 0.9, height: 1.87, depth: 0.9, color: 0xc0a888 },
    turtle:       { width: 1.2, height: 0.4,  depth: 1.2, color: 0x3a8a2e },
    rabbit:       { width: 0.4, height: 0.5,  depth: 0.4, color: 0xb5835a },
    fox:          { width: 0.6, height: 0.7,  depth: 0.6, color: 0xd57835 },
    bee:          { width: 0.7, height: 0.6,  depth: 0.7, color: 0xedc343 },
    goat:         { width: 0.9, height: 1.3,  depth: 0.9, color: 0xb5a58c },
    frog:         { width: 0.5, height: 0.55, depth: 0.5, color: 0x7ea553 },
    allay:        { width: 0.35, height: 0.6, depth: 0.35, color: 0x59c3e0 },
    bat:          { width: 0.5, height: 0.9,  depth: 0.5, color: 0x4e3d2e },
    squid:        { width: 0.8, height: 0.8,  depth: 0.8, color: 0x223366 },
    glow_squid:   { width: 0.8, height: 0.8,  depth: 0.8, color: 0x0a9994 },
    dolphin:      { width: 0.9, height: 0.6,  depth: 0.9, color: 0x8899aa },
    guardian:     { width: 0.85, height: 0.85, depth: 0.85, color: 0x5f8a72 },
    elder_guardian: { width: 1.99, height: 1.99, depth: 1.99, color: 0xb5a58c },
    warden:       { width: 0.9, height: 2.9,  depth: 0.9, color: 0x0b4a4a },
    ravager:      { width: 1.95, height: 2.2,  depth: 1.95, color: 0x767676 },
    ghast:        { width: 4.0, height: 4.0,  depth: 4.0, color: 0xf0f0f0 },
    magma_cube:   { width: 0.5, height: 0.5,  depth: 0.5, color: 0x440000 },
    hoglin:       { width: 1.4, height: 1.4,  depth: 1.4, color: 0x8b5a3a },
    zoglin:       { width: 1.4, height: 1.4,  depth: 1.4, color: 0x88aa88 },
    wither:       { width: 0.9, height: 3.5,  depth: 0.9, color: 0x222222 },
    ender_dragon: { width: 4.0, height: 4.0,  depth: 4.0, color: 0x1a1a2e },
    silverfish:   { width: 0.4, height: 0.3,  depth: 0.4, color: 0x6e6e6e },
    endermite:    { width: 0.4, height: 0.3,  depth: 0.4, color: 0x3b2754 },
    cave_spider:  { width: 0.7, height: 0.5,  depth: 0.7, color: 0x0c424e },
    shulker:      { width: 1.0, height: 1.0,  depth: 1.0, color: 0x8b5e8b },
    breeze:       { width: 0.6, height: 1.77, depth: 0.6, color: 0x89cff0 },
    bogged:       { width: 0.6, height: 1.99, depth: 0.6, color: 0x6a8a3a },
    panda:        { width: 1.3, height: 1.25, depth: 1.3, color: 0xf0f0f0 },
    polar_bear:   { width: 1.4, height: 1.4,  depth: 1.4, color: 0xf0f0f0 },
    ocelot:       { width: 0.6, height: 0.7,  depth: 0.6, color: 0xe8a020 },
    mooshroom:    { width: 0.9, height: 1.4,  depth: 0.9, color: 0xaa2222 },
    snow_golem:   { width: 0.7, height: 1.9,  depth: 0.7, color: 0xf0f0f0 },
    strider:      { width: 0.9, height: 1.7,  depth: 0.9, color: 0x993333 },
    axolotl:      { width: 0.75, height: 0.42, depth: 0.75, color: 0xf0a0c0 },
    camel:        { width: 1.7, height: 2.375, depth: 1.7, color: 0xd4a55a },
    sniffer:      { width: 1.9, height: 1.75, depth: 1.9, color: 0x6a8a44 },
    armadillo:    { width: 0.7, height: 0.65, depth: 0.7, color: 0xa0744a },
    vex:          { width: 0.4, height: 0.8,  depth: 0.4, color: 0x8899cc },
    wandering_trader: { width: 0.6, height: 1.95, depth: 0.6, color: 0x2255aa },
    creaking:     { width: 0.9, height: 2.7,  depth: 0.9, color: 0x3a2a1a },
    item:         { width: 0.25, height: 0.25, depth: 0.25, color: 0xffff00 },
    dropped_item: { width: 0.25, height: 0.25, depth: 0.25, color: 0xffff00 },
    experience_orb: { width: 0.2, height: 0.2, depth: 0.2, color: 0x80ff80 },
    minecart:         { width: 0.98, height: 0.7,  depth: 0.98, color: 0x666666 },
    chest_minecart:   { width: 0.98, height: 0.7,  depth: 0.98, color: 0x8b6914 },
    hopper_minecart:  { width: 0.98, height: 0.7,  depth: 0.98, color: 0x666666 },
    tnt_minecart:     { width: 0.98, height: 0.7,  depth: 0.98, color: 0xcc3333 },
    furnace_minecart: { width: 0.98, height: 0.7,  depth: 0.98, color: 0x888888 },
    spawner_minecart: { width: 0.98, height: 0.7,  depth: 0.98, color: 0x333366 },
    command_block_minecart: { width: 0.98, height: 0.7, depth: 0.98, color: 0xcc8855 },
    boat:             { width: 1.375, height: 0.5625, depth: 1.375, color: 0x8b6914 },
    oak_boat:         { width: 1.375, height: 0.5625, depth: 1.375, color: 0x8b6914 },
    spruce_boat:      { width: 1.375, height: 0.5625, depth: 1.375, color: 0x5b3a1e },
    birch_boat:       { width: 1.375, height: 0.5625, depth: 1.375, color: 0xc8b77a },
    jungle_boat:      { width: 1.375, height: 0.5625, depth: 1.375, color: 0x9a6a40 },
    acacia_boat:      { width: 1.375, height: 0.5625, depth: 1.375, color: 0xa0522d },
    dark_oak_boat:    { width: 1.375, height: 0.5625, depth: 1.375, color: 0x3a2a0a },
    mangrove_boat:    { width: 1.375, height: 0.5625, depth: 1.375, color: 0x6b3a3a },
    cherry_boat:      { width: 1.375, height: 0.5625, depth: 1.375, color: 0xd4869a },
    bamboo_raft:      { width: 1.375, height: 0.5625, depth: 1.375, color: 0x7a9a2a },
    oak_chest_boat:   { width: 1.375, height: 0.5625, depth: 1.375, color: 0x8b6914 },
    chest_boat:       { width: 1.375, height: 0.5625, depth: 1.375, color: 0x8b6914 },
    fishing_bobber:   { width: 0.25, height: 0.25, depth: 0.25, color: 0xcc3333 },
    leash_knot:       { width: 0.375, height: 0.5, depth: 0.375, color: 0x8b6914 },
    painting:         { width: 1.0, height: 1.0, depth: 0.0625, color: 0x8b6914 },
  };

  private static readonly DEFAULT_ENTITY_STYLE = { width: 0.6, height: 1.0, depth: 0.6, color: 0xaa55aa };

  /**
   * Create an entity group with textured rendering where possible.
   * Falls back to colored boxes for mobs without atlas textures.
   */
  private createTexturedEntityGroup(entityTypeName: string): THREE.Group {
    const group = new THREE.Group();

    // Handle item entities with metadata (e.g. "item:diamond_sword")
    if (entityTypeName.startsWith('item:')) {
      const itemName = entityTypeName.substring(5);
      return this.createItemEntityGroup(itemName, entityTypeName);
    }

    // Falling block with state ID (e.g. "falling_block:1234") → textured cube from block mapping
    if (entityTypeName.startsWith('falling_block:')) {
      const stateId = parseInt(entityTypeName.substring(14), 10);
      if (!isNaN(stateId) && this.atlasMapping) {
        const blockEntry = this.atlasMapping.blocks[stateId];
        if (blockEntry) {
          const blockMesh = this.createBlockMeshFromFaces(blockEntry);
          if (blockMesh) {
            blockMesh.scale.set(2.86, 2.86, 2.86);
            blockMesh.position.y = 0.5;
            group.add(blockMesh);
            this.addEntityNametag(group, 'falling_block', 1.5);
            return group;
          }
        }
      }
    }

    // Block entities (TNT, primed_tnt) → textured cube
    const blockName = PrismarineRenderer.ENTITY_BLOCK_NAMES[entityTypeName];
    if (blockName) {
      const blockMesh = this.createHeldItemMesh(blockName);
      if (blockMesh) {
        // Scale to full block size
        blockMesh.scale.set(2.86, 2.86, 2.86); // 1.0 / 0.35 = ~2.86
        blockMesh.position.y = 0.5;
        group.add(blockMesh);
        this.addEntityNametag(group, entityTypeName, 1.5);
        return group;
      }
    }

    // Projectile / sprite entities → billboard from atlas
    const itemTexName = PrismarineRenderer.ENTITY_ITEM_TEXTURES[entityTypeName];
    if (itemTexName) {
      const spriteMesh = this.createEntitySprite(itemTexName);
      if (spriteMesh) {
        // End crystals should be much larger than projectiles
        if (entityTypeName === 'end_crystal' || entityTypeName === 'ender_crystal') {
          spriteMesh.scale.set(3.0, 3.0, 3.0);
          spriteMesh.position.y = 1.0;
        }
        group.add(spriteMesh);
        return group;
      }
    }

    // Item / dropped_item with no metadata → generic item cube
    if (entityTypeName === 'item' || entityTypeName === 'dropped_item') {
      return this.createItemEntityGroup('', entityTypeName);
    }

    // Mobs: try textured model first, fall back to colored box
    const style = PrismarineRenderer.ENTITY_STYLES[entityTypeName] || PrismarineRenderer.DEFAULT_ENTITY_STYLE;
    const entityTex = this.entityTextureCache.get(entityTypeName);

    if (entityTex && PrismarineRenderer.HUMANOID_MOBS.has(entityTypeName)) {
      // Textured humanoid mob — same model structure as player
      const texMat = new THREE.MeshLambertMaterial({ map: entityTex, alphaTest: 0.1 });

      // Body pivot
      const bodyPivot = new THREE.Group();
      bodyPivot.name = 'bodyPivot';

      // Torso
      const torsoGeo = new THREE.BoxGeometry(0.5, 0.75, 0.25);
      PrismarineRenderer.setSkinUVs(torsoGeo, {
        front: [20, 20, 8, 12], right: [16, 20, 4, 12], back: [32, 20, 8, 12], left: [28, 20, 4, 12],
        top: [20, 16, 8, 4], bottom: [28, 16, 8, 4],
      });
      bodyPivot.add(new THREE.Mesh(torsoGeo, texMat));
      (bodyPivot.children[0] as THREE.Mesh).position.y = 0.375;

      // Head
      const headGroup = new THREE.Group();
      headGroup.name = 'head';
      headGroup.position.y = 0.75;
      const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      PrismarineRenderer.setSkinUVs(headGeo, {
        front: [8, 8, 8, 8], right: [0, 8, 8, 8], back: [24, 8, 8, 8], left: [16, 8, 8, 8],
        top: [8, 0, 8, 8], bottom: [16, 0, 8, 8],
      });
      const headMesh = new THREE.Mesh(headGeo, texMat);
      headMesh.position.y = 0.25;
      headGroup.add(headMesh);
      bodyPivot.add(headGroup);

      // Right arm
      const rightArmPivot = new THREE.Group();
      rightArmPivot.name = 'rightArm';
      rightArmPivot.position.set(0.375, 0.75, 0);
      const rArmGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
      PrismarineRenderer.setSkinUVs(rArmGeo, {
        front: [44, 20, 4, 12], right: [40, 20, 4, 12], back: [52, 20, 4, 12], left: [48, 20, 4, 12],
        top: [44, 16, 4, 4], bottom: [48, 16, 4, 4],
      });
      const rArm = new THREE.Mesh(rArmGeo, texMat);
      rArm.position.y = -0.375;
      rightArmPivot.add(rArm);
      bodyPivot.add(rightArmPivot);

      // Left arm
      const leftArmPivot = new THREE.Group();
      leftArmPivot.name = 'leftArm';
      leftArmPivot.position.set(-0.375, 0.75, 0);
      const lArmGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
      PrismarineRenderer.setSkinUVs(lArmGeo, {
        front: [36, 52, 4, 12], right: [32, 52, 4, 12], back: [44, 52, 4, 12], left: [40, 52, 4, 12],
        top: [36, 48, 4, 4], bottom: [40, 48, 4, 4],
      });
      const lArm = new THREE.Mesh(lArmGeo, texMat);
      lArm.position.y = -0.375;
      leftArmPivot.add(lArm);
      bodyPivot.add(leftArmPivot);

      bodyPivot.position.y = 0.75;
      group.add(bodyPivot);

      // Right leg
      const rightLegPivot = new THREE.Group();
      rightLegPivot.name = 'rightLeg';
      rightLegPivot.position.set(0.125, 0.75, 0);
      const rLegGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
      PrismarineRenderer.setSkinUVs(rLegGeo, {
        front: [4, 20, 4, 12], right: [0, 20, 4, 12], back: [12, 20, 4, 12], left: [8, 20, 4, 12],
        top: [4, 16, 4, 4], bottom: [8, 16, 4, 4],
      });
      const rLeg = new THREE.Mesh(rLegGeo, texMat);
      rLeg.position.y = -0.375;
      rightLegPivot.add(rLeg);
      group.add(rightLegPivot);

      // Left leg
      const leftLegPivot = new THREE.Group();
      leftLegPivot.name = 'leftLeg';
      leftLegPivot.position.set(-0.125, 0.75, 0);
      const lLegGeo = new THREE.BoxGeometry(0.25, 0.75, 0.25);
      PrismarineRenderer.setSkinUVs(lLegGeo, {
        front: [20, 52, 4, 12], right: [16, 52, 4, 12], back: [28, 52, 4, 12], left: [24, 52, 4, 12],
        top: [20, 48, 4, 4], bottom: [24, 48, 4, 4],
      });
      const lLeg = new THREE.Mesh(lLegGeo, texMat);
      lLeg.position.y = -0.375;
      leftLegPivot.add(lLeg);
      group.add(leftLegPivot);

      this.addEntityNametag(group, entityTypeName, 2.3);
    } else if (entityTex) {
      // Textured non-humanoid mob — box with entity texture mapped to faces
      const texMat = new THREE.MeshLambertMaterial({ map: entityTex, alphaTest: 0.1 });
      const geo = new THREE.BoxGeometry(style.width, style.height, style.depth);
      const mesh = new THREE.Mesh(geo, texMat);
      mesh.position.y = style.height / 2;
      group.add(mesh);

      this.addEntityNametag(group, entityTypeName, style.height + 0.5);
    } else if (PrismarineRenderer.HUMANOID_MOBS.has(entityTypeName)) {
      // Colored humanoid fallback
      const bodyHeight = style.height - 0.5;
      const bodyGeo = new THREE.BoxGeometry(style.width, bodyHeight, style.depth);
      const bodyMat = new THREE.MeshLambertMaterial({ color: style.color });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = bodyHeight / 2;
      group.add(body);

      const headSize = Math.max(style.width, 0.5);
      const headGeo = new THREE.BoxGeometry(headSize, headSize, headSize);
      const headColor = new THREE.Color(style.color);
      headColor.offsetHSL(0, 0, 0.15);
      const headMat = new THREE.MeshLambertMaterial({ color: headColor });
      const headMesh = new THREE.Mesh(headGeo, headMat);
      headMesh.position.y = bodyHeight + headSize / 2;
      group.add(headMesh);

      this.addEntityNametag(group, entityTypeName, style.height + 0.5);
    } else {
      // Colored non-humanoid fallback
      const geo = new THREE.BoxGeometry(style.width, style.height, style.depth);
      const mat = new THREE.MeshLambertMaterial({ color: style.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = style.height / 2;
      group.add(mesh);

      this.addEntityNametag(group, entityTypeName, style.height + 0.5);
    }

    return group;
  }

  /**
   * Create an item entity group (dropped item on ground).
   */
  private createItemEntityGroup(itemName: string, displayTypeName: string): THREE.Group {
    const group = new THREE.Group();

    if (itemName) {
      // Try to render as textured item
      const itemMesh = this.createHeldItemMesh(itemName);
      if (itemMesh) {
        itemMesh.position.y = 0.25;
        itemMesh.scale.set(0.6, 0.6, 0.6);
        group.add(itemMesh);
        return group;
      }
    }

    // Fallback: small yellow cube
    const geo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffff00 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.25;
    group.add(mesh);

    return group;
  }

  /**
   * Create a billboard sprite for a projectile/entity using atlas item texture.
   */
  private createEntitySprite(itemTexName: string): THREE.Mesh | null {
    const mapping = this.atlasMapping;
    if (!mapping || !this.atlasTexture) return null;

    // Try item/<name> first, then just <name>, then fallback
    const itemInfo = this.itemMapping.get(itemTexName);
    const texKey = itemInfo?.texture || `item/${itemTexName}`;
    let texUV = mapping.textures[texKey];

    // Try fallback for animated/variant items
    if (!texUV) {
      const fallback = PrismarineRenderer.ITEM_TEXTURE_FALLBACKS[itemTexName];
      if (fallback) texUV = mapping.textures[fallback];
    }

    if (!texUV) return null;

    const mat = new THREE.MeshBasicMaterial({
      map: this.atlasTexture,
      alphaTest: 0.1,
      side: THREE.DoubleSide,
      transparent: true,
    });

    const geo = new THREE.PlaneGeometry(0.5, 0.5);
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
    uvAttr.setXY(0, texUV.u, texUV.v);
    uvAttr.setXY(1, texUV.u + texUV.su, texUV.v);
    uvAttr.setXY(2, texUV.u, texUV.v + texUV.sv);
    uvAttr.setXY(3, texUV.u + texUV.su, texUV.v + texUV.sv);
    uvAttr.needsUpdate = true;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.25;
    // Billboard: always face camera (set in render loop or use onBeforeRender)
    mesh.onBeforeRender = (renderer, scene, camera) => {
      mesh.quaternion.copy(camera.quaternion);
    };
    return mesh;
  }

  /**
   * Add a floating nametag sprite to an entity group.
   */
  private addEntityNametag(group: THREE.Group, entityTypeName: string, yOffset: number): void {
    const displayName = entityTypeName.replace(/_/g, ' ');
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 256, 48);
    ctx.fillStyle = '#cccccc';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(displayName, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.y = yOffset;
    sprite.scale.set(1.5, 0.35, 1);
    group.add(sprite);
  }

  /**
   * Update an entity's position and rotation in the scene.
   */
  updateEntity(entityId: number, x: number, y: number, z: number, yaw: number, _pitch: number, entityTypeName?: string): void {
    let group = this.entityMeshes.get(entityId);
    const prevTypeName = this.entityTypeNames.get(entityId);

    // Recreate entity mesh if type name changed (e.g. "item" → "item:diamond_sword")
    if (group && entityTypeName && entityTypeName !== prevTypeName) {
      this.scene.remove(group);
      group = undefined;
    }

    if (!group) {
      const typeName = entityTypeName || '';
      group = this.createTexturedEntityGroup(typeName);
      this.scene.add(group);
      this.entityMeshes.set(entityId, group);
      if (typeName) this.entityTypeNames.set(entityId, typeName);
    }

    group.position.set(x, y, z);
    // Don't rotate dropped items (they spin in updateEntityAnimations)
    const typeName = this.entityTypeNames.get(entityId);
    if (typeName && !typeName.startsWith('item') && typeName !== 'dropped_item') {
      group.rotation.y = Math.PI - yaw * (Math.PI / 180);
    }
  }

  /**
   * Remove an entity from the scene, optionally spawning an explosion.
   */
  removeEntity(entityId: number, entityTypeName?: string): void {
    const group = this.entityMeshes.get(entityId);
    if (group) {
      // Trigger explosion for explosive entity types
      const typeName = entityTypeName || this.entityTypeNames.get(entityId) || '';
      if (PrismarineRenderer.EXPLOSIVE_TYPES.has(typeName)) {
        this.spawnExplosion(group.position.x, group.position.y + 0.5, group.position.z, typeName === 'tnt' ? 2.0 : 1.0, typeName);
      }
      this.scene.remove(group);
      this.entityMeshes.delete(entityId);
      this.entityTypeNames.delete(entityId);
    }
  }

  /**
   * Get all entity IDs currently known to the renderer.
   */
  getKnownEntityIds(): Set<number> {
    return new Set(this.entityMeshes.keys());
  }

  /**
   * Spawn a particle explosion effect at the given position.
   * Wind charges produce a blue/cyan horizontal ring burst; other explosions produce fire + smoke.
   */
  private spawnExplosion(x: number, y: number, z: number, size: number, typeName: string): void {
    if (typeName === 'wind_charge') {
      this.spawnWindChargeExplosion(x, y, z);
      return;
    }

    // --- TNT / generic explosion: fire + smoke particles with a flash sphere ---
    const count = Math.floor(40 + size * 20);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const smokeStart = Math.floor(count * 0.5); // first half = fire, second half = smoke

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;

      if (i < smokeStart) {
        // Fire particles — fast outward burst
        const speed = (2 + Math.random() * 3) * size;
        velocities[i3] = Math.sin(phi) * Math.cos(theta) * speed;
        velocities[i3 + 1] = Math.cos(phi) * speed * 0.5 + Math.random() * 1.5;
        velocities[i3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
        // Orange-yellow
        const t = Math.random();
        colors[i3] = 1.0;
        colors[i3 + 1] = 0.3 + t * 0.5;
        colors[i3 + 2] = t * 0.1;
      } else {
        // Smoke particles — slow upward drift
        const speed = (0.5 + Math.random() * 1.5) * size;
        velocities[i3] = Math.sin(phi) * Math.cos(theta) * speed * 0.4;
        velocities[i3 + 1] = 1.0 + Math.random() * 2.0;
        velocities[i3 + 2] = Math.sin(phi) * Math.sin(theta) * speed * 0.4;
        // Gray-black smoke
        const g = 0.15 + Math.random() * 0.25;
        colors[i3] = g;
        colors[i3 + 1] = g;
        colors[i3 + 2] = g;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.3 * size,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    // Flash sphere — white sphere that expands and fades quickly
    const flashGeo = new THREE.SphereGeometry(0.3 * size, 12, 12);
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffee,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(x, y, z);
    this.scene.add(flash);

    this.activeExplosions.push({
      particles: points,
      velocities,
      startTime: performance.now(),
      duration: 800,
      extraMeshes: [flash],
    });
  }

  /**
   * Spawn a wind-charge-style explosion: blue/cyan particles in a horizontal ring burst
   * plus an expanding transparent ring.
   */
  private spawnWindChargeExplosion(x: number, y: number, z: number): void {
    const count = 18;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      // Horizontal ring pattern — particles spread outward on the XZ plane
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = 2.5 + Math.random() * 1.5;
      velocities[i3] = Math.cos(angle) * speed;
      velocities[i3 + 1] = (Math.random() - 0.5) * 0.5; // very slight vertical spread
      velocities[i3 + 2] = Math.sin(angle) * speed;

      // Blue / cyan / white palette
      const t = Math.random();
      colors[i3] = 0.5 + t * 0.5;      // R: 0.5-1.0
      colors[i3 + 1] = 0.7 + t * 0.3;  // G: 0.7-1.0
      colors[i3 + 2] = 1.0;             // B: 1.0
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.2,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      sizeAttenuation: true,
    });

    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    // Expanding ring effect
    const ring = this.spawnWindChargeRing(x, y, z);

    this.activeExplosions.push({
      particles: points,
      velocities,
      startTime: performance.now(),
      duration: 500,
      noGravity: true,
      extraMeshes: [ring],
    });
  }

  /**
   * Create an expanding, fading horizontal ring for wind charge effects.
   * Returns the ring mesh (lifecycle managed by the explosion entry).
   */
  private spawnWindChargeRing(x: number, y: number, z: number): THREE.Mesh {
    const ringGeo = new THREE.RingGeometry(0.3, 0.5, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x89cff0,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(x, y, z);
    // Rotate to lie flat (horizontal)
    ring.rotation.x = -Math.PI / 2;
    this.scene.add(ring);
    return ring;
  }

  /**
   * Update active explosion particles. Called each frame.
   */
  private updateExplosions(): void {
    const now = performance.now();
    for (let i = this.activeExplosions.length - 1; i >= 0; i--) {
      const exp = this.activeExplosions[i];
      const elapsed = now - exp.startTime;
      const t = Math.min(elapsed / exp.duration, 1.0);

      if (t >= 1.0) {
        this.scene.remove(exp.particles);
        exp.particles.geometry.dispose();
        (exp.particles.material as THREE.PointsMaterial).dispose();
        if (exp.extraMeshes) {
          for (const mesh of exp.extraMeshes) {
            this.scene.remove(mesh);
            if (mesh instanceof THREE.Mesh) {
              mesh.geometry.dispose();
              (mesh.material as THREE.Material).dispose();
            }
          }
        }
        this.activeExplosions.splice(i, 1);
        continue;
      }

      // Update particle positions
      const posAttr = exp.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const dt = 0.016; // ~60fps timestep
      const count = posAttr.count;
      for (let j = 0; j < count; j++) {
        const j3 = j * 3;
        posAttr.array[j3] += exp.velocities[j3] * dt;
        posAttr.array[j3 + 1] += exp.velocities[j3 + 1] * dt;
        posAttr.array[j3 + 2] += exp.velocities[j3 + 2] * dt;
        if (!exp.noGravity) {
          exp.velocities[j3 + 1] -= 9.8 * dt;
        }
      }
      posAttr.needsUpdate = true;

      // Fade out and shrink particles
      const mat = exp.particles.material as THREE.PointsMaterial;
      mat.opacity = 1.0 - t;
      mat.size *= 0.98;

      // Update extra meshes (flash sphere or wind charge ring)
      if (exp.extraMeshes) {
        for (const mesh of exp.extraMeshes) {
          if (!(mesh instanceof THREE.Mesh)) continue;
          const meshMat = mesh.material as THREE.MeshBasicMaterial;
          if (mesh.geometry instanceof THREE.SphereGeometry) {
            // Flash sphere: expand fast and fade within first 20% of duration
            const flashT = Math.min(t / 0.2, 1.0);
            const scale = 1.0 + flashT * 4.0;
            mesh.scale.set(scale, scale, scale);
            meshMat.opacity = 0.9 * (1.0 - flashT);
          } else if (mesh.geometry instanceof THREE.RingGeometry) {
            // Wind charge ring: expand from 0.3 to 2.0 radius, fade out
            const ringT = Math.min(t / 0.8, 1.0); // ring animates over 80% of duration
            const scale = 1.0 + ringT * (2.0 / 0.3 - 1.0);
            mesh.scale.set(scale, scale, scale);
            meshMat.opacity = 0.8 * (1.0 - ringT);
          }
        }
      }
    }
  }

  // Player meshes: uuid → group (body + head + nametag)
  private playerMeshes: Map<string, THREE.Group> = new Map();

  /**
   * Create a multi-part player model group.
   */
  private createPlayerGroup(name: string): THREE.Group {
    const group = new THREE.Group();

    // Body pivot — tilts when sneaking
    const bodyPivot = new THREE.Group();
    bodyPivot.name = 'bodyPivot';

    // Torso (0.5 x 0.75 x 0.25)
    const torsoGeo = new THREE.BoxGeometry(0.5, 0.75, 0.25);
    const torsoMat = new THREE.MeshLambertMaterial({ color: 0x4488cc });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 0.375;
    bodyPivot.add(torso);

    // Head (0.5 x 0.5 x 0.5) — separate pivot for yaw + pitch
    const head = new THREE.Group();
    head.name = 'head';
    head.rotation.order = 'YXZ'; // yaw (Y) first, then pitch (X)
    head.position.y = 0.75;
    const headMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xddaa77 }),
    );
    headMesh.position.y = 0.25;
    head.add(headMesh);
    bodyPivot.add(head);

    // Right arm pivot at shoulder (+X side)
    const rightArmPivot = new THREE.Group();
    rightArmPivot.name = 'rightArm';
    rightArmPivot.position.set(0.375, 0.75, 0);
    const rightArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.75, 0.25),
      new THREE.MeshLambertMaterial({ color: 0x4488cc }),
    );
    rightArm.position.y = -0.375;
    rightArmPivot.add(rightArm);
    bodyPivot.add(rightArmPivot);

    // Left arm pivot at shoulder (-X side)
    const leftArmPivot = new THREE.Group();
    leftArmPivot.name = 'leftArm';
    leftArmPivot.position.set(-0.375, 0.75, 0);
    const leftArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.75, 0.25),
      new THREE.MeshLambertMaterial({ color: 0x4488cc }),
    );
    leftArm.position.y = -0.375;
    leftArmPivot.add(leftArm);
    bodyPivot.add(leftArmPivot);

    bodyPivot.position.y = 0.75;
    group.add(bodyPivot);

    // Right leg pivot at hip (+X side)
    const rightLegPivot = new THREE.Group();
    rightLegPivot.name = 'rightLeg';
    rightLegPivot.position.set(0.125, 0.75, 0);
    const rightLeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.75, 0.25),
      new THREE.MeshLambertMaterial({ color: 0x333366 }),
    );
    rightLeg.position.y = -0.375;
    rightLegPivot.add(rightLeg);
    group.add(rightLegPivot);

    // Left leg pivot at hip (-X side)
    const leftLegPivot = new THREE.Group();
    leftLegPivot.name = 'leftLeg';
    leftLegPivot.position.set(-0.125, 0.75, 0);
    const leftLeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.75, 0.25),
      new THREE.MeshLambertMaterial({ color: 0x333366 }),
    );
    leftLeg.position.y = -0.375;
    leftLegPivot.add(leftLeg);
    group.add(leftLegPivot);

    // Nametag sprite above head (no background, with health)
    const nametagSprite = PrismarineRenderer.createNametagSprite(name, 20);
    group.add(nametagSprite);

    return group;
  }

  /**
   * Create a nametag sprite with player name and health hearts (no background).
   */
  private static createNametagSprite(name: string, health: number): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 64);

    // Draw name
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeText(name, 256, 20);
    ctx.fillText(name, 256, 20);

    // Draw health as hearts below name
    const fullHearts = Math.floor(health / 2);
    const halfHeart = health % 2 >= 1;
    const totalHearts = 10;
    const heartSize = 12;
    const startX = 256 - (totalHearts * (heartSize + 1)) / 2;

    for (let i = 0; i < totalHearts; i++) {
      const hx = startX + i * (heartSize + 1);
      const hy = 42;
      if (i < fullHearts) {
        ctx.fillStyle = '#ff2222';
      } else if (i === fullHearts && halfHeart) {
        ctx.fillStyle = '#ff6666';
      } else {
        ctx.fillStyle = 'rgba(80,0,0,0.5)';
      }
      // Simple heart shape using unicode or a filled rect (pixel style)
      ctx.fillRect(hx, hy, heartSize, heartSize - 2);
      // Small notch at top for heart shape
      ctx.fillRect(hx + 1, hy - 2, heartSize / 2 - 1, 3);
      ctx.fillRect(hx + heartSize / 2 + 1, hy - 2, heartSize / 2 - 2, 3);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.LinearFilter;
    const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.name = 'nametag';
    sprite.position.y = 2.3;
    sprite.scale.set(3, 0.4, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  /**
   * Update a player's position, rotation, and animations in the scene.
   */
  // Armor material colors by armor type keyword (fallback when no block texture)
  private static readonly ARMOR_COLORS: Record<string, number> = {
    diamond: 0x00cccc,
    iron: 0xc0c0c0,
    gold: 0xffd700,
    golden: 0xffd700,
    netherite: 0x3a3a3a,
    leather: 0x8b4513,
    chainmail: 0xa8a8a8,
    chain: 0xa8a8a8,
    turtle: 0x40a060,
  };

  private static getArmorColor(itemName: string): number | null {
    for (const [key, color] of Object.entries(PrismarineRenderer.ARMOR_COLORS)) {
      if (itemName.includes(key)) return color;
    }
    return null;
  }

  /** Get the armor material name from an item name (e.g. "diamond_helmet" → "diamond") */
  private static getArmorMaterial(itemName: string): string | null {
    const materials = ['diamond', 'iron', 'golden', 'netherite', 'leather', 'chainmail', 'turtle'];
    for (const mat of materials) {
      if (itemName.includes(mat)) return mat === 'golden' ? 'gold' : mat;
    }
    return null;
  }

  /** Get the armor layer key: leggings use layer2, everything else uses layer1 */
  private static getArmorLayer(itemName: string): string {
    return itemName.includes('leggings') ? 'layer2' : 'layer1';
  }

  /**
   * Minecraft armor UV regions (pixel coords on 64×32 texture).
   * Derived from HumanoidModel textureOffsets and box dimensions.
   * Format: [x, y, width, height] in pixels.
   */
  private static readonly ARMOR_UV_PARTS: Record<string, {
    right: [number, number, number, number];
    left: [number, number, number, number];
    top: [number, number, number, number];
    bottom: [number, number, number, number];
    front: [number, number, number, number];
    back: [number, number, number, number];
  }> = {
    // Head: textureOffset(0,0), box 8×8×8
    head: {
      right: [0, 8, 8, 8], left: [16, 8, 8, 8],
      top: [8, 0, 8, 8], bottom: [16, 0, 8, 8],
      front: [8, 8, 8, 8], back: [24, 8, 8, 8],
    },
    // Body: textureOffset(16,16), box 8×12×4
    body: {
      right: [16, 20, 4, 12], left: [28, 20, 4, 12],
      top: [20, 16, 8, 4], bottom: [28, 16, 8, 4],
      front: [20, 20, 8, 12], back: [32, 20, 8, 12],
    },
    // Arm: textureOffset(40,16), box 4×12×4
    arm: {
      right: [40, 20, 4, 12], left: [48, 20, 4, 12],
      top: [44, 16, 4, 4], bottom: [48, 16, 4, 4],
      front: [44, 20, 4, 12], back: [52, 20, 4, 12],
    },
    // Leg: textureOffset(0,16), box 4×12×4
    leg: {
      right: [0, 20, 4, 12], left: [8, 20, 4, 12],
      top: [4, 16, 4, 4], bottom: [8, 16, 4, 4],
      front: [4, 20, 4, 12], back: [12, 20, 4, 12],
    },
  };

  /**
   * Set UV coordinates on a BoxGeometry to map a specific armor part
   * from a 64×32 armor texture.
   */
  private static setArmorUVs(
    geo: THREE.BoxGeometry,
    partType: 'head' | 'body' | 'arm' | 'leg',
    mirrored: boolean = false,
  ): void {
    const part = PrismarineRenderer.ARMOR_UV_PARTS[partType];
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
    const TW = 64, TH = 32;

    // Three.js BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z
    // After PI rotation: +Z=back, -Z=front (same swap as skin)
    const faceOrder: (keyof typeof part)[] = ['right', 'left', 'top', 'bottom', 'back', 'front'];

    for (let fi = 0; fi < 6; fi++) {
      let faceName = faceOrder[fi];
      // When mirrored (left arm/leg), swap right↔left face assignments
      if (mirrored) {
        if (faceName === 'right') faceName = 'left';
        else if (faceName === 'left') faceName = 'right';
      }

      const [px, py, pw, ph] = part[faceName];
      const u = px / TW;
      const v = py / TH;
      const su = pw / TW;
      const sv = ph / TH;

      const base = fi * 4;
      if (mirrored && faceName !== 'top' && faceName !== 'bottom') {
        // Flip U horizontally for mirrored side/front/back faces
        uvAttr.setXY(base + 0, u + su, v);
        uvAttr.setXY(base + 1, u, v);
        uvAttr.setXY(base + 2, u + su, v + sv);
        uvAttr.setXY(base + 3, u, v + sv);
      } else {
        uvAttr.setXY(base + 0, u, v);
        uvAttr.setXY(base + 1, u + su, v);
        uvAttr.setXY(base + 2, u, v + sv);
        uvAttr.setXY(base + 3, u + su, v + sv);
      }
    }
    uvAttr.needsUpdate = true;
  }

  /**
   * Create an armor piece mesh using the actual Minecraft armor texture
   * with proper UV mapping for the given body part.
   * Falls back to a solid color if no armor texture is cached.
   */
  private createArmorMesh(
    itemName: string,
    width: number, height: number, depth: number,
    partType: 'head' | 'body' | 'arm' | 'leg',
    mirrored: boolean = false,
  ): THREE.Mesh {
    const geo = new THREE.BoxGeometry(width, height, depth);

    const material = PrismarineRenderer.getArmorMaterial(itemName);
    const layer = PrismarineRenderer.getArmorLayer(itemName);

    if (material) {
      const cacheKey = `${material}_${layer}`;
      const armorTex = this.armorTextureCache.get(cacheKey);

      if (armorTex) {
        PrismarineRenderer.setArmorUVs(geo, partType, mirrored);
        return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
          map: armorTex,
          alphaTest: 0.1,
        }));
      }
    }

    // Fallback: solid color
    const color = PrismarineRenderer.getArmorColor(itemName) ?? 0x888888;
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color }));
  }

  // Track current armor to avoid recreating every frame
  private playerArmorState: Map<string, string> = new Map();

  // Track nametag health to avoid re-rendering every frame
  private playerNametagHealth: Map<string, number> = new Map();

  updatePlayer(
    uuid: string, name: string,
    x: number, y: number, z: number,
    yaw: number, pitch: number,
    sneaking: boolean = false,
    lastSwingTime: number = 0,
    currentTimeMs: number = 0,
    skinUuid?: string,
    heldItem?: string,
    lastDamageTime: number = 0,
    equipment?: Map<number, string | { itemName: string; enchantments?: Array<{ id: string; level: number }> }>,
    health: number = 20,
  ): void {
    let group = this.playerMeshes.get(uuid);

    if (!group) {
      group = this.createPlayerGroup(name);
      this.scene.add(group);
      this.playerMeshes.set(uuid, group);
    }

    // Skin loading
    const skinId = skinUuid || uuid;
    if (!this.skinTextures.has(skinId)) {
      this.skinTextures.set(skinId, null); // mark as loading
      this.loadSkinTexture(skinId).then(tex => {
        if (tex) {
          this.skinTextures.set(skinId, tex);
          const g = this.playerMeshes.get(uuid);
          if (g) this.applySkinToGroup(g, tex, skinId);
        }
      });
    } else {
      const cachedTex = this.skinTextures.get(skinId);
      if (cachedTex && group.userData.skinApplied !== skinId) {
        this.applySkinToGroup(group, cachedTex, skinId);
      }
    }

    group.position.set(x, y, z);

    // Update nametag if health changed
    const prevHealth = this.playerNametagHealth.get(uuid);
    if (prevHealth === undefined || Math.floor(prevHealth) !== Math.floor(health)) {
      this.playerNametagHealth.set(uuid, health);
      const oldTag = group.getObjectByName('nametag');
      if (oldTag) {
        group.remove(oldTag);
        (oldTag as THREE.Sprite).material.map?.dispose();
        (oldTag as THREE.Sprite).material.dispose();
      }
      const newTag = PrismarineRenderer.createNametagSprite(name, health);
      group.add(newTag);
    }

    // Sneak animation — lean upper body forward (toward local -Z = MC forward)
    const bodyPivot = group.getObjectByName('bodyPivot');
    if (bodyPivot) {
      if (sneaking) {
        bodyPivot.position.y = 0.45;
        bodyPivot.rotation.x = -0.5;
      } else {
        bodyPivot.position.y = 0.75;
        bodyPivot.rotation.x = 0;
      }
    }

    // Arm swing animation
    const rightArm = group.getObjectByName('rightArm');
    const leftArm = group.getObjectByName('leftArm');
    const rightLeg = group.getObjectByName('rightLeg');
    const leftLeg = group.getObjectByName('leftLeg');
    const swingElapsed = currentTimeMs - lastSwingTime;

    const isSwinging = lastSwingTime > 0 && swingElapsed >= 0 && swingElapsed < 300;

    // Walk cycle — compute speed and movement direction from position deltas
    const prev = this.playerPrevPositions.get(uuid);
    let speed = 0;
    let moveDir = 0; // movement direction in degrees (Minecraft yaw convention)
    if (prev) {
      const dx = x - prev.x;
      const dz = z - prev.z;
      const dt = (currentTimeMs - prev.time) / 1000;
      const elapsed = dt > 0 ? dt : 0.016;
      speed = Math.sqrt(dx * dx + dz * dz) / elapsed;
      if (speed > 0.5) {
        // Convert movement vector to Minecraft yaw degrees
        // MC yaw: 0=south(+Z), 90=west(-X), 180=north(-Z), 270=east(+X)
        moveDir = -Math.atan2(-dx, dz) * (180 / Math.PI);
      } else {
        moveDir = prev.moveDir;
      }
      if (dt >= 0.05) {
        this.playerPrevPositions.set(uuid, { x, z, time: currentTimeMs, moveDir });
      }
    } else {
      this.playerPrevPositions.set(uuid, { x, z, time: currentTimeMs, moveDir: yaw });
    }

    // Body/head yaw split:
    // In Minecraft, the body faces the movement direction when walking.
    // The head (yaw from replay) can look independently up to ~75° from body.
    // When standing still, body stays put but clamps to 75° from head.
    const MAX_HEAD_TURN = 15;
    let bodyYaw = this.playerBodyYaw.get(uuid) ?? yaw;

    if (speed > 1.0) {
      // Moving: body faces movement direction, smoothly lerp toward it
      let diff = moveDir - bodyYaw;
      diff = ((diff % 360) + 540) % 360 - 180;
      bodyYaw += diff * 0.25;
    }

    // Always clamp body to within MAX_HEAD_TURN of head yaw
    let diff = yaw - bodyYaw;
    diff = ((diff % 360) + 540) % 360 - 180;
    if (Math.abs(diff) > MAX_HEAD_TURN) {
      bodyYaw = yaw - Math.sign(diff) * MAX_HEAD_TURN;
    }

    this.playerBodyYaw.set(uuid, bodyYaw);

    // Apply body rotation to group
    group.rotation.y = Math.PI - bodyYaw * (Math.PI / 180);

    // Apply head rotation (relative yaw from body + pitch)
    const head = group.getObjectByName('head');
    if (head) {
      let headRelYaw = yaw - bodyYaw;
      headRelYaw = ((headRelYaw % 360) + 540) % 360 - 180;
      head.rotation.y = -headRelYaw * (Math.PI / 180);
      head.rotation.x = -pitch * (Math.PI / 180);
    }

    // Debug: log once per second
    if (!this._lastDebugLog || currentTimeMs - this._lastDebugLog > 1000) {
      this._lastDebugLog = currentTimeMs;
      console.log(`[HeadRot] headYaw=${yaw.toFixed(1)} bodyYaw=${bodyYaw.toFixed(1)} moveDir=${moveDir.toFixed(1)} diff=${(yaw-bodyYaw).toFixed(1)} speed=${speed.toFixed(2)}`);
    }

    if (speed > 0.5) {
      const swing = Math.sin(currentTimeMs * 8 / 1000) * (Math.PI / 4) * Math.min(speed / 6, 1);
      if (rightLeg) rightLeg.rotation.x = swing;
      if (leftLeg) leftLeg.rotation.x = -swing;

      // Counter-swing arms when walking (unless attack swing is active)
      if (!isSwinging) {
        if (rightArm) rightArm.rotation.x = -swing;
        if (leftArm) leftArm.rotation.x = swing;
      }
    } else {
      if (rightLeg) rightLeg.rotation.x = 0;
      if (leftLeg) leftLeg.rotation.x = 0;
    }

    // Arm swing animation (attack) — positive rotation.x swings arm forward with corrected yaw
    if (isSwinging) {
      const t = swingElapsed / 300;
      const swingAngle = Math.sin(t * Math.PI) * (Math.PI / 2);
      if (rightArm) rightArm.rotation.x = swingAngle;
      if (leftArm) leftArm.rotation.x = 0;
    } else if (speed <= 0.5) {
      if (rightArm) rightArm.rotation.x = 0;
      if (leftArm) leftArm.rotation.x = 0;
    }

    // Held item mesh
    const itemName = heldItem ?? '';
    const prevItem = this.playerHeldItems.get(uuid);
    if (itemName !== prevItem) {
      this.playerHeldItems.set(uuid, itemName);
      if (rightArm) {
        // Remove old item mesh
        const oldItem = rightArm.getObjectByName('heldItemMesh');
        if (oldItem) rightArm.remove(oldItem);

        if (itemName && itemName !== 'air') {
          const itemMesh = this.createHeldItemMesh(itemName);
          if (itemMesh) {
            itemMesh.name = 'heldItemMesh';
            const isBlock = this.itemMapping.get(itemName)?.isBlock
              || this.blockNameToState.has(itemName);
            if (isBlock) {
              // Block items: small cube held at bottom of arm
              itemMesh.position.set(0, -0.75, -0.2);
            } else {
              // Non-block items: plane is XY by default (blade already points down).
              // Rotate 90° around Y so flat face faces sideways (+X), offset to clear the arm.
              // PlaneGeo is in XY (normal +Z, flat face faces forward).
              // Rotate π/2 around Y so normal faces +X (sideways) — blade
              // hangs down along Y, flat face visible from the side.
              itemMesh.position.set(0, -0.55, -0.35);
              itemMesh.rotation.set(0, Math.PI / 2, -Math.PI / 4);
            }
            rightArm.add(itemMesh);
          }
        }
      }
    }

    // Armor overlays
    if (equipment) {
      const getEquipName = (slot: number): string => {
        const val = equipment.get(slot);
        if (!val) return '';
        return typeof val === 'string' ? val : val.itemName;
      };
      const armorKey = Array.from(equipment.entries()).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${typeof v === 'string' ? v : v.itemName}`).join(',');
      const prevArmorKey = this.playerArmorState.get(uuid);
      if (armorKey !== prevArmorKey) {
        this.playerArmorState.set(uuid, armorKey);
        // Remove old armor overlays
        const oldArmors: THREE.Object3D[] = [];
        group.traverse((child) => { if (child.name.startsWith('armor_')) oldArmors.push(child); });
        for (const a of oldArmors) a.parent?.remove(a);

        // Slot 2=HEAD, 3=CHEST, 4=LEGS, 5=FEET
        // Armor renders as slightly-larger overlay boxes covering the body part (like MC)
        const headItem = getEquipName(2);
        const chestItem = getEquipName(3);
        const legsItem = getEquipName(4);
        const feetItem = getEquipName(5);

        if (headItem && headItem !== 'air') {
          const armorHead = this.createArmorMesh(headItem, 0.56, 0.56, 0.56, 'head');
          armorHead.name = 'armor_head';
          armorHead.position.y = 0.25;
          const headGroup = group.getObjectByName('head');
          if (headGroup) headGroup.add(armorHead);
        }

        if (chestItem && chestItem !== 'air') {
          // Torso overlay
          const armorChest = this.createArmorMesh(chestItem, 0.56, 0.8, 0.3, 'body');
          armorChest.name = 'armor_chest';
          armorChest.position.y = 0.375;
          const bp = group.getObjectByName('bodyPivot');
          if (bp) bp.add(armorChest);
          // Arm overlays (left arm is mirrored)
          for (const armName of ['rightArm', 'leftArm']) {
            const armPivot = group.getObjectByName(armName);
            if (armPivot) {
              const armorArm = this.createArmorMesh(chestItem, 0.3, 0.8, 0.3, 'arm', armName === 'leftArm');
              armorArm.name = `armor_${armName}`;
              armorArm.position.y = -0.375;
              armPivot.add(armorArm);
            }
          }
        }

        if (legsItem && legsItem !== 'air') {
          for (const legName of ['rightLeg', 'leftLeg']) {
            const legPivot = group.getObjectByName(legName);
            if (legPivot) {
              const armorLeg = this.createArmorMesh(legsItem, 0.3, 0.8, 0.3, 'leg', legName === 'leftLeg');
              armorLeg.name = `armor_${legName}`;
              armorLeg.position.y = -0.375;
              legPivot.add(armorLeg);
            }
          }
        }

        if (feetItem && feetItem !== 'air') {
          for (const legName of ['rightLeg', 'leftLeg']) {
            const legPivot = group.getObjectByName(legName);
            if (legPivot) {
              const armorBoot = this.createArmorMesh(feetItem, 0.3, 0.5, 0.35, 'leg', legName === 'leftLeg');
              armorBoot.name = `armor_boot_${legName}`;
              armorBoot.position.set(0, -0.5, 0.025);
              legPivot.add(armorBoot);
            }
          }
        }

        // Offhand item (slot 1)
        const offhandItem = getEquipName(1);
        const leftArmGroup = group.getObjectByName('leftArm');
        if (leftArmGroup) {
          const oldOffhand = leftArmGroup.getObjectByName('offhandItemMesh');
          if (oldOffhand) leftArmGroup.remove(oldOffhand);

          if (offhandItem && offhandItem !== 'air') {
            const offhandMesh = this.createHeldItemMesh(offhandItem);
            if (offhandMesh) {
              offhandMesh.name = 'offhandItemMesh';
              const isBlock = this.itemMapping.get(offhandItem)?.isBlock || this.blockNameToState.has(offhandItem);
              if (isBlock) {
                offhandMesh.position.set(0, -0.75, -0.2);
              } else {
                offhandMesh.position.set(0, -0.55, -0.35);
                offhandMesh.rotation.set(0, Math.PI / 2, -Math.PI / 4);
              }
              leftArmGroup.add(offhandMesh);
            }
          }
        }
      }
    }

    // Damage red tint: flash red for 400ms after taking damage
    const DAMAGE_FLASH_MS = 400;
    const damageElapsed = currentTimeMs - lastDamageTime;
    const isDamaged = lastDamageTime > 0 && damageElapsed >= 0 && damageElapsed < DAMAGE_FLASH_MS;
    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshLambertMaterial;
        if (mat.emissive) {
          if (isDamaged) {
            const intensity = 1 - (damageElapsed / DAMAGE_FLASH_MS);
            mat.emissive.setRGB(intensity, 0, 0);
          } else {
            mat.emissive.setRGB(0, 0, 0);
          }
        }
      }
    });
  }

  /**
   * Remove a player from the scene.
   */
  removePlayer(uuid: string): void {
    const group = this.playerMeshes.get(uuid);
    if (group) {
      this.scene.remove(group);
      this.playerMeshes.delete(uuid);
    }
    this.playerPrevPositions.delete(uuid);
    this.playerHeldItems.delete(uuid);
    this.playerBodyYaw.delete(uuid);
  }

  /**
   * Reset all cached player state (armor, held items, body yaw, etc.).
   * Call this before a seek so stale state doesn't persist across time jumps.
   */
  resetPlayerState(): void {
    console.log(`[ResetState] Clearing ${this.playerMeshes.size} players, ${this.entityMeshes.size} entities, armor keys: ${Array.from(this.playerArmorState.entries()).map(([k,v]) => `${k.slice(0,8)}=${v}`).join('; ')}`);
    // Remove all player meshes from scene
    this.playerMeshes.forEach((group) => this.scene.remove(group));
    this.playerMeshes.clear();
    this.playerPrevPositions.clear();
    this.playerHeldItems.clear();
    this.playerArmorState.clear();
    this.playerBodyYaw.clear();
    this.playerNametagHealth.clear();
    // Remove all entity meshes from scene
    this.entityMeshes.forEach((group) => this.scene.remove(group));
    this.entityMeshes.clear();
  }

  /**
   * Create a small mesh for a held item.
   * Block items use a textured cube from the atlas; non-block items use a textured flat quad.
   * Unknown items fall back to a colored flat quad.
   */
  /**
   * Create a textured block mesh directly from block face data (for falling_block entities).
   */
  private createBlockMeshFromFaces(blockFaces: { top: string; side: string; bottom: string }): THREE.Mesh | null {
    const mapping = this.atlasMapping;
    if (!mapping || !this.atlasTexture) return null;
    const size = 0.35;
    const geo = new THREE.BoxGeometry(size, size, size);
    const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
    const faceTexNames = [
      blockFaces.side, blockFaces.side,
      blockFaces.top, blockFaces.bottom,
      blockFaces.side, blockFaces.side,
    ];
    for (let fi = 0; fi < 6; fi++) {
      const texUV = mapping.textures[faceTexNames[fi]];
      if (!texUV) continue;
      const base = fi * 4;
      uvAttr.setXY(base + 0, texUV.u, texUV.v);
      uvAttr.setXY(base + 1, texUV.u + texUV.su, texUV.v);
      uvAttr.setXY(base + 2, texUV.u, texUV.v + texUV.sv);
      uvAttr.setXY(base + 3, texUV.u + texUV.su, texUV.v + texUV.sv);
    }
    uvAttr.needsUpdate = true;
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: this.atlasTexture, alphaTest: 0.1 }));
  }

  private createHeldItemMesh(itemName: string): THREE.Mesh | null {
    const mapping = this.atlasMapping;
    const itemInfo = this.itemMapping.get(itemName);
    // Block items: textured cube from block face textures
    if (itemInfo?.isBlock) {
      const stateId = this.blockNameToState.get(itemName);
      if (stateId !== undefined && mapping) {
        const blockFaces = mapping.blocks[stateId];
        if (blockFaces && this.atlasTexture) {
          const size = 0.35;
          const geo = new THREE.BoxGeometry(size, size, size);
          const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
          const faceTexNames = [
            blockFaces.side, blockFaces.side,
            blockFaces.top, blockFaces.bottom,
            blockFaces.side, blockFaces.side,
          ];
          for (let fi = 0; fi < 6; fi++) {
            const texUV = mapping.textures[faceTexNames[fi]];
            if (!texUV) continue;
            const base = fi * 4;
            uvAttr.setXY(base + 0, texUV.u, texUV.v);
            uvAttr.setXY(base + 1, texUV.u + texUV.su, texUV.v);
            uvAttr.setXY(base + 2, texUV.u, texUV.v + texUV.sv);
            uvAttr.setXY(base + 3, texUV.u + texUV.su, texUV.v + texUV.sv);
          }
          uvAttr.needsUpdate = true;
          const mat = new THREE.MeshLambertMaterial({
            map: this.atlasTexture,
            alphaTest: 0.1,
          });
          return new THREE.Mesh(geo, mat);
        }
      }
    }

    // Non-block items: two back-to-back planes (3D sprite, no edge artifacts)
    if (itemInfo?.texture && mapping && this.atlasTexture) {
      const texUV = mapping.textures[itemInfo.texture];
      if (texUV) {
        const mat = new THREE.MeshLambertMaterial({
          map: this.atlasTexture,
          alphaTest: 0.1,
          side: THREE.DoubleSide,
        });
        const frontGeo = new THREE.PlaneGeometry(0.85, 0.85);
        const frontUV = frontGeo.getAttribute('uv') as THREE.BufferAttribute;
        frontUV.setXY(0, texUV.u, texUV.v);
        frontUV.setXY(1, texUV.u + texUV.su, texUV.v);
        frontUV.setXY(2, texUV.u, texUV.v + texUV.sv);
        frontUV.setXY(3, texUV.u + texUV.su, texUV.v + texUV.sv);
        frontUV.needsUpdate = true;
        const mesh = new THREE.Mesh(frontGeo, mat);
        return mesh;
      }
    }

    // Fallback: also try blockNameToState for items without itemMapping (backward compat)
    const stateId = this.blockNameToState.get(itemName);
    if (stateId !== undefined && mapping) {
      const blockFaces = mapping.blocks[stateId];
      if (blockFaces && this.atlasTexture) {
        const size = 0.35;
        const geo = new THREE.BoxGeometry(size, size, size);
        const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
        const faceTexNames = [
          blockFaces.side, blockFaces.side,
          blockFaces.top, blockFaces.bottom,
          blockFaces.side, blockFaces.side,
        ];
        for (let fi = 0; fi < 6; fi++) {
          const texUV = mapping.textures[faceTexNames[fi]];
          if (!texUV) continue;
          const base = fi * 4;
          uvAttr.setXY(base + 0, texUV.u, texUV.v);
          uvAttr.setXY(base + 1, texUV.u + texUV.su, texUV.v);
          uvAttr.setXY(base + 2, texUV.u, texUV.v + texUV.sv);
          uvAttr.setXY(base + 3, texUV.u + texUV.su, texUV.v + texUV.sv);
        }
        uvAttr.needsUpdate = true;
        const mat = new THREE.MeshLambertMaterial({
          map: this.atlasTexture,
          alphaTest: 0.1,
        });
        return new THREE.Mesh(geo, mat);
      }
    }

    // Try fallback texture mapping for animated/variant items
    const fallbackTex = PrismarineRenderer.ITEM_TEXTURE_FALLBACKS[itemName];
    if (fallbackTex && mapping && this.atlasTexture) {
      const texUV = mapping.textures[fallbackTex];
      if (texUV) {
        const mat = new THREE.MeshLambertMaterial({
          map: this.atlasTexture,
          alphaTest: 0.1,
          side: THREE.DoubleSide,
        });
        const fbGeo = new THREE.PlaneGeometry(0.85, 0.85);
        const fbUV = fbGeo.getAttribute('uv') as THREE.BufferAttribute;
        fbUV.setXY(0, texUV.u, texUV.v);
        fbUV.setXY(1, texUV.u + texUV.su, texUV.v);
        fbUV.setXY(2, texUV.u, texUV.v + texUV.sv);
        fbUV.setXY(3, texUV.u + texUV.su, texUV.v + texUV.sv);
        fbUV.needsUpdate = true;
        return new THREE.Mesh(fbGeo, mat);
      }
    }

    // Unknown item: colored flat quad placeholder
    const geo = new THREE.PlaneGeometry(0.85, 0.85);
    let hash = 0;
    for (let i = 0; i < itemName.length; i++) {
      hash = ((hash << 5) - hash + itemName.charCodeAt(i)) | 0;
    }
    const hue = (Math.abs(hash) % 360) / 360;
    const color = new THREE.Color().setHSL(hue, 0.7, 0.5);
    const mat = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    return new THREE.Mesh(geo, mat);
  }

  /**
   * Register embedded skin PNG data from the replay file.
   * Must be called before updatePlayer so the skin is available when the player mesh is created.
   */
  setEmbeddedSkin(uuid: string, skinPng: Uint8Array): void {
    this.embeddedSkins.set(uuid, skinPng);
  }

  /**
   * Preload all embedded skins as textures and apply to existing player meshes.
   * Returns a Promise that resolves when all skins are loaded.
   */
  async preloadEmbeddedSkins(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [uuid] of this.embeddedSkins) {
      if (!this.skinTextures.has(uuid) || this.skinTextures.get(uuid) === null) {
        this.skinTextures.set(uuid, null);
        promises.push(
          this.loadSkinTexture(uuid).then(tex => {
            if (tex) {
              this.skinTextures.set(uuid, tex);
              // Apply to any player mesh that uses this skin
              for (const [, group] of this.playerMeshes) {
                if (group.userData.skinApplied !== uuid) {
                  this.applySkinToGroup(group, tex, uuid);
                }
              }
            }
          })
        );
      }
    }
    await Promise.all(promises);
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getDomElement(): HTMLCanvasElement | null {
    return this.renderer?.domElement ?? null;
  }

  updateSize(): void {
    if (!this.container || !this.renderer) return;
    const { clientWidth, clientHeight } = this.container;
    this.renderer.setSize(clientWidth, clientHeight);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.renderer?.dispose();
    if (this.renderer?.domElement?.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
    this.atlasTexture?.dispose();
    this.atlasMaterial?.dispose();
    this.transparentAtlasMaterial?.dispose();
    for (const tex of this.armorTextureCache.values()) {
      tex.dispose();
    }
    this.armorTextureCache.clear();
    for (const tex of this.entityTextureCache.values()) {
      tex.dispose();
    }
    this.entityTextureCache.clear();
    for (const tex of this.skinTextures.values()) {
      tex?.dispose();
    }
    this.skinTextures.clear();
    this.playerPrevPositions.clear();
    this.playerHeldItems.clear();
    this.playerArmorState.clear();
    this.playerBodyYaw.clear();
    this.playerNametagHealth.clear();
    this.entityMeshes.clear();
    this.entityTypeNames.clear();
    for (const exp of this.activeExplosions) {
      this.scene.remove(exp.particles);
      exp.particles.geometry.dispose();
      (exp.particles.material as THREE.PointsMaterial).dispose();
      if (exp.extraMeshes) {
        for (const mesh of exp.extraMeshes) {
          this.scene.remove(mesh);
          if (mesh instanceof THREE.Mesh) {
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
          }
        }
      }
    }
    this.activeExplosions.length = 0;
    this.scene.clear();
    this.sections.clear();
    this.blockMap.clear();
    this.initialized = false;
  }

  // --- Private methods ---

  private setupBasicScene(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(50, 100, 50);
    this.scene.add(sun);
  }

  // =========================================================================
  // Atlas-based textured rendering (section meshes)
  // =========================================================================

  private static sectionKey(x: number, y: number, z: number): SectionKey {
    return `${x >> 4},${y >> 4},${z >> 4}`;
  }

  private async loadBlocksTextured(blocks: BlockSnapshot[]): Promise<void> {
    if (blocks.length === 0) return;

    // Populate blockMap
    for (const block of blocks) {
      this.blockMap.set(`${block.x},${block.y},${block.z}`, block.stateId);
    }

    // Group blocks by section
    const sectionBlocks = new Map<SectionKey, BlockSnapshot[]>();
    for (const block of blocks) {
      const key = PrismarineRenderer.sectionKey(block.x, block.y, block.z);
      let arr = sectionBlocks.get(key);
      if (!arr) {
        arr = [];
        sectionBlocks.set(key, arr);
      }
      arr.push(block);
    }

    // Build sections in batches, yielding to the browser between batches
    const keys = Array.from(sectionBlocks.keys());
    const BATCH_SIZE = 8;
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);
      for (const key of batch) {
        this.buildSectionMesh(key);
      }
      // Yield to browser between batches so the UI stays responsive
      if (i + BATCH_SIZE < keys.length) {
        await new Promise<void>(r => setTimeout(r, 0));
      }
    }

    console.log(`[PrismarineRenderer] Loaded ${blocks.length} blocks in ${this.sections.size} sections (textured)`);
  }

  private updateBlockTextured(change: BlockChange): void {
    const posKey = `${change.x},${change.y},${change.z}`;
    const oldSectionKey = PrismarineRenderer.sectionKey(change.x, change.y, change.z);

    if (change.stateId === 0) {
      this.blockMap.delete(posKey);
    } else {
      this.blockMap.set(posKey, change.stateId);
    }

    this.dirtySections.add(oldSectionKey);

    // Also mark neighbor sections dirty (block on section boundary affects neighbor face culling)
    const bx = change.x, by = change.y, bz = change.z;
    if ((bx & 15) === 0) this.dirtySections.add(PrismarineRenderer.sectionKey(bx - 1, by, bz));
    if ((bx & 15) === 15) this.dirtySections.add(PrismarineRenderer.sectionKey(bx + 1, by, bz));
    if ((by & 15) === 0) this.dirtySections.add(PrismarineRenderer.sectionKey(bx, by - 1, bz));
    if ((by & 15) === 15) this.dirtySections.add(PrismarineRenderer.sectionKey(bx, by + 1, bz));
    if ((bz & 15) === 0) this.dirtySections.add(PrismarineRenderer.sectionKey(bx, by, bz - 1));
    if ((bz & 15) === 15) this.dirtySections.add(PrismarineRenderer.sectionKey(bx, by, bz + 1));
  }

  private rebuildDirtySections(): void {
    for (const key of this.dirtySections) {
      this.buildSectionMesh(key);
    }
    this.dirtySections.clear();
  }

  private buildSectionMesh(key: SectionKey): void {
    // Remove old meshes
    const oldPair = this.sections.get(key);
    if (oldPair) {
      if (oldPair.opaque) { this.scene.remove(oldPair.opaque); oldPair.opaque.geometry.dispose(); }
      if (oldPair.transparent) { this.scene.remove(oldPair.transparent); oldPair.transparent.geometry.dispose(); }
      this.sections.delete(key);
    }

    const [sx, sy, sz] = key.split(',').map(Number);
    const baseX = sx * 16;
    const baseY = sy * 16;
    const baseZ = sz * 16;

    const mapping = this.atlasMapping!;

    // Separate buffers for opaque and transparent geometry
    const opaquePos: number[] = [], opaqueNorm: number[] = [], opaqueUV: number[] = [], opaqueIdx: number[] = [];
    let opaqueVert = 0;
    const transPos: number[] = [], transNorm: number[] = [], transUV: number[] = [], transIdx: number[] = [];
    let transVert = 0;

    // Iterate all blocks in this section
    for (let lx = 0; lx < 16; lx++) {
      for (let ly = 0; ly < 16; ly++) {
        for (let lz = 0; lz < 16; lz++) {
          const wx = baseX + lx;
          const wy = baseY + ly;
          const wz = baseZ + lz;
          const posKey = `${wx},${wy},${wz}`;
          const stateId = this.blockMap.get(posKey);
          if (stateId === undefined || stateId === 0 || this.hiddenStates.has(stateId)) continue;

          const blockFaces = mapping.blocks[stateId];
          if (!blockFaces) continue;

          const isTransparent = this.transparentStates.has(stateId);
          const waterHeight = this.waterLevelMap.get(stateId);

          // Multiface blocks: render thin quads on active faces
          if (blockFaces.shape === 'multiface' && blockFaces.faceMask !== undefined) {
            const texUV = mapping.textures[blockFaces.side];
            if (!texUV) continue;

            for (const face of MULTIFACE_FACES) {
              if (!(blockFaces.faceMask & face.mask)) continue;
              for (const quad of face.quads) {
                for (let vi = 0; vi < 4; vi++) {
                  const v = quad.vertices[vi];
                  transPos.push(wx + v[0], wy + v[1], wz + v[2]);
                  transNorm.push(quad.normal[0], quad.normal[1], quad.normal[2]);
                  const fuv = FACE_UVS[vi];
                  transUV.push(texUV.u + fuv[0] * texUV.su, texUV.v + fuv[1] * texUV.sv);
                }
                for (const qi of QUAD_INDICES) {
                  transIdx.push(transVert + qi);
                }
                transVert += 4;
              }
            }
            continue;
          }

          // Cross-model blocks: render as X-shaped quads
          const isCross = blockFaces.shape === 'cross';
          if (isCross) {
            const texUV = mapping.textures[blockFaces.side];
            if (!texUV) continue;

            for (const quad of CROSS_QUADS) {
              for (let vi = 0; vi < 4; vi++) {
                const v = quad.vertices[vi];
                transPos.push(wx + v[0], wy + v[1], wz + v[2]);
                transNorm.push(quad.normal[0], quad.normal[1], quad.normal[2]);
                const fuv = FACE_UVS[vi];
                transUV.push(texUV.u + fuv[0] * texUV.su, texUV.v + fuv[1] * texUV.sv);
              }
              for (const qi of QUAD_INDICES) {
                transIdx.push(transVert + qi);
              }
              transVert += 4;
            }
            continue; // Skip normal cube faces
          }

          // Floor-model blocks: render as flat horizontal quad
          if (blockFaces.shape === 'floor') {
            const texUV = mapping.textures[blockFaces.top] || mapping.textures[blockFaces.side];
            if (!texUV) continue;

            for (const quad of FLOOR_QUADS) {
              for (let vi = 0; vi < 4; vi++) {
                const v = quad.vertices[vi];
                transPos.push(wx + v[0], wy + v[1], wz + v[2]);
                transNorm.push(quad.normal[0], quad.normal[1], quad.normal[2]);
                const fuv = FACE_UVS[vi];
                transUV.push(texUV.u + fuv[0] * texUV.su, texUV.v + fuv[1] * texUV.sv);
              }
              for (const qi of QUAD_INDICES) {
                transIdx.push(transVert + qi);
              }
              transVert += 4;
            }
            continue; // Skip normal cube faces
          }

          // Choose target buffers based on transparency
          const pos = isTransparent ? transPos : opaquePos;
          const norm = isTransparent ? transNorm : opaqueNorm;
          const uv = isTransparent ? transUV : opaqueUV;
          const idx = isTransparent ? transIdx : opaqueIdx;
          const getVert = () => isTransparent ? transVert : opaqueVert;
          const addVert = (n: number) => { if (isTransparent) transVert += n; else opaqueVert += n; };

          // Check each face
          for (const [faceName, faceData] of Object.entries(FACE_DATA)) {
            const [dx, dy, dz] = faceData.dir;
            const nx = wx + dx;
            const ny = wy + dy;
            const nz = wz + dz;
            const neighborKey = `${nx},${ny},${nz}`;
            const neighborState = this.blockMap.get(neighborKey);

            // Face culling: skip face if neighbor is opaque, or same transparent block type
            if (neighborState !== undefined && neighborState !== 0 && !this.hiddenStates.has(neighborState)) {
              const neighborTransparent = this.transparentStates.has(neighborState);
              if (!neighborTransparent) continue; // opaque neighbor → skip face
              // Both current and neighbor are transparent + same block type → skip
              if (isTransparent) {
                const curBlock = this.stateToBlockId.get(stateId);
                const nbrBlock = this.stateToBlockId.get(neighborState);
                if (curBlock !== undefined && curBlock === nbrBlock) {
                  // For water: only cull if same height (different levels need visible step)
                  const curWater = this.waterLevelMap.get(stateId);
                  const nbrWater = this.waterLevelMap.get(neighborState);
                  if (curWater === undefined || curWater === nbrWater) continue;
                }
              }
            }

            // Determine which texture to use for this face
            let texName: string;
            if (faceName === 'up') texName = blockFaces.top;
            else if (faceName === 'down') texName = blockFaces.bottom;
            else texName = blockFaces.side;

            const texUV = mapping.textures[texName];
            if (!texUV) continue;

            const curVert = getVert();

            // Emit 4 vertices
            for (let vi = 0; vi < 4; vi++) {
              const vert = faceData.vertices[vi];
              let vy = wy + vert[1];
              // Water height: cap top vertices
              if (waterHeight !== undefined && vert[1] === 1) {
                vy = wy + waterHeight;
              }
              pos.push(wx + vert[0], vy, wz + vert[2]);
              norm.push(faceData.normal[0], faceData.normal[1], faceData.normal[2]);
              // Map face UV to atlas sub-region
              const fuv = FACE_UVS[vi];
              uv.push(texUV.u + fuv[0] * texUV.su, texUV.v + fuv[1] * texUV.sv);
            }

            // Emit 2 triangles (6 indices)
            for (const qi of QUAD_INDICES) {
              idx.push(curVert + qi);
            }
            addVert(4);
          }
        }
      }
    }

    let opaqueMesh: THREE.Mesh | null = null;
    let transparentMesh: THREE.Mesh | null = null;

    if (opaquePos.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(opaquePos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(opaqueNorm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(opaqueUV, 2));
      geo.setIndex(opaqueIdx);
      opaqueMesh = new THREE.Mesh(geo, this.atlasMaterial!);
      this.scene.add(opaqueMesh);
    }

    if (transPos.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(transPos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(transNorm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(transUV, 2));
      geo.setIndex(transIdx);
      transparentMesh = new THREE.Mesh(geo, this.transparentAtlasMaterial!);
      this.scene.add(transparentMesh);
    }

    if (opaqueMesh || transparentMesh) {
      this.sections.set(key, { opaque: opaqueMesh, transparent: transparentMesh });
    }
  }

  // =========================================================================
  // Player skin loading
  // =========================================================================

  private async loadSkinTexture(uuid: string): Promise<THREE.Texture | null> {
    // Try embedded skin data first (from replay file)
    const cleanUuid = uuid.replace(/-/g, '');
    const embeddedPng = this.embeddedSkins.get(uuid) || this.embeddedSkins.get(cleanUuid);
    if (embeddedPng && embeddedPng.length > 0) {
      try {
        const blob = new Blob([embeddedPng], { type: 'image/png' });
        const objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.src = objectUrl;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => { URL.revokeObjectURL(objectUrl); resolve(); };
          img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Failed to load embedded skin')); };
        });
        const tex = new THREE.Texture(img);
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
      } catch (e) {
        console.warn('[PrismarineRenderer] Failed to load embedded skin for', uuid, e);
      }
    }

    // Fallback: try fetching from mineskin.eu (Crafatar alternative)
    try {
      const url = `https://mineskin.eu/skin/${cleanUuid}`;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load skin'));
      });
      const tex = new THREE.Texture(img);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    } catch (e) {
      console.warn('[PrismarineRenderer] Failed to load skin for', uuid, e);
      return null;
    }
  }

  /**
   * Set UV coordinates on a BoxGeometry for a specific face from the skin texture.
   * faceCoords: [x, y, w, h] in pixel coordinates on a 64×64 skin.
   * Three.js BoxGeometry face order: +x(right), -x(left), +y(top), -y(bottom), +z(front), -z(back)
   * Each face has 4 UV pairs in the uv attribute.
   */
  private static setSkinUVs(
    geometry: THREE.BoxGeometry,
    faces: {
      right: [number, number, number, number];
      left: [number, number, number, number];
      top: [number, number, number, number];
      bottom: [number, number, number, number];
      front: [number, number, number, number];
      back: [number, number, number, number];
    },
  ): void {
    const uvAttr = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const W = 64, H = 64;

    // Three.js BoxGeometry face order: +x, -x, +y, -y, +z, -z
    // Each face: 4 vertices × 2 uv components = 8 values
    // Model faces -Z locally, then PI rotation around Y flips it for world orientation.
    // After PI rotation: +Z face = world back, -Z face = world front.
    // Swap front↔back so the skin face texture appears on the correct side.
    const faceOrder: (keyof typeof faces)[] = ['right', 'left', 'top', 'bottom', 'back', 'front'];

    for (let fi = 0; fi < 6; fi++) {
      const [px, py, pw, ph] = faces[faceOrder[fi]];
      const u0 = px / W, v0 = py / H;
      const u1 = (px + pw) / W, v1 = (py + ph) / H;

      const base = fi * 4;
      // BoxGeometry UV layout per face: (u0,v0), (u1,v0), (u0,v1), (u1,v1)
      uvAttr.setXY(base + 0, u0, 1 - v0);
      uvAttr.setXY(base + 1, u1, 1 - v0);
      uvAttr.setXY(base + 2, u0, 1 - v1);
      uvAttr.setXY(base + 3, u1, 1 - v1);
    }
    uvAttr.needsUpdate = true;
  }

  private applySkinToGroup(group: THREE.Group, texture: THREE.Texture, skinId?: string): void {
    if (group.userData.skinApplied) return;
    group.userData.skinApplied = skinId || true;

    const skinMat = new THREE.MeshLambertMaterial({
      map: texture,
      alphaTest: 0.1,
    });

    // Skin layout coordinates: [x, y, width, height] in 64×64 space
    const SKIN_PARTS: Record<string, {
      right: [number, number, number, number];
      left: [number, number, number, number];
      top: [number, number, number, number];
      bottom: [number, number, number, number];
      front: [number, number, number, number];
      back: [number, number, number, number];
    }> = {
      head: {
        front: [8, 8, 8, 8], right: [0, 8, 8, 8], back: [24, 8, 8, 8], left: [16, 8, 8, 8],
        top: [8, 0, 8, 8], bottom: [16, 0, 8, 8],
      },
      torso: {
        front: [20, 20, 8, 12], right: [16, 20, 4, 12], back: [32, 20, 8, 12], left: [28, 20, 4, 12],
        top: [20, 16, 8, 4], bottom: [28, 16, 8, 4],
      },
      rightArmMesh: {
        front: [44, 20, 4, 12], right: [40, 20, 4, 12], back: [52, 20, 4, 12], left: [48, 20, 4, 12],
        top: [44, 16, 4, 4], bottom: [48, 16, 4, 4],
      },
      leftArmMesh: {
        front: [36, 52, 4, 12], right: [32, 52, 4, 12], back: [44, 52, 4, 12], left: [40, 52, 4, 12],
        top: [36, 48, 4, 4], bottom: [40, 48, 4, 4],
      },
      rightLegMesh: {
        front: [4, 20, 4, 12], right: [0, 20, 4, 12], back: [12, 20, 4, 12], left: [8, 20, 4, 12],
        top: [4, 16, 4, 4], bottom: [8, 16, 4, 4],
      },
      leftLegMesh: {
        front: [20, 52, 4, 12], right: [16, 52, 4, 12], back: [28, 52, 4, 12], left: [24, 52, 4, 12],
        top: [20, 48, 4, 4], bottom: [24, 48, 4, 4],
      },
    };

    // Map mesh names in the group to skin part names
    const meshNameToSkinPart: Record<string, string> = {};

    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      // Skip overlay meshes (armor, held items) — they have explicit names
      if (child.name) return;

      // Determine which skin part this mesh belongs to
      let skinPartName: string | null = null;

      // The mesh parent determines which body part
      const parentName = child.parent?.name || '';
      if (parentName === 'head') skinPartName = 'head';
      else if (parentName === 'rightArm') skinPartName = 'rightArmMesh';
      else if (parentName === 'leftArm') skinPartName = 'leftArmMesh';
      else if (parentName === 'rightLeg') skinPartName = 'rightLegMesh';
      else if (parentName === 'leftLeg') skinPartName = 'leftLegMesh';
      else if (parentName === 'bodyPivot' && !child.name) {
        // Torso is direct child of bodyPivot (not named)
        skinPartName = 'torso';
      }

      if (!skinPartName || !SKIN_PARTS[skinPartName]) return;

      const geo = child.geometry;
      if (geo instanceof THREE.BoxGeometry) {
        PrismarineRenderer.setSkinUVs(geo, SKIN_PARTS[skinPartName]);
        child.material = skinMat;
      }
    });
  }

  // =========================================================================
  // Fallback: InstancedMesh colored cubes (no atlas)
  // =========================================================================

  private instancedMesh: THREE.InstancedMesh | null = null;
  private blockIndexMap: Map<string, number> = new Map();
  private instanceCount: number = 0;
  private maxInstances: number = 0;
  private hiddenScale = new THREE.Matrix4().makeScale(0, 0, 0);

  private loadBlocksBasic(blocks: BlockSnapshot[]): void {
    if (blocks.length === 0) return;

    this.maxInstances = blocks.length + 1024;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshLambertMaterial({ vertexColors: false });

    const mesh = new THREE.InstancedMesh(geometry, material, this.maxInstances);
    mesh.count = blocks.length;
    this.instanceCount = blocks.length;

    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      matrix.identity();
      matrix.setPosition(block.x + 0.5, block.y + 0.5, block.z + 0.5);
      mesh.setMatrixAt(i, matrix);

      const hue = (block.stateId * 137) % 360;
      color.setHSL(hue / 360, 0.6, 0.5);
      mesh.setColorAt(i, color);

      this.blockIndexMap.set(`${block.x},${block.y},${block.z}`, i);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.scene.add(mesh);
    this.instancedMesh = mesh;
    console.log(`[PrismarineRenderer] Loaded ${blocks.length} blocks via InstancedMesh`);
  }

  private updateBlockBasic(change: BlockChange): void {
    if (!this.instancedMesh) return;
    const key = `${change.x},${change.y},${change.z}`;
    const existingIdx = this.blockIndexMap.get(key);

    if (change.stateId === 0) {
      if (existingIdx !== undefined) {
        this.instancedMesh.setMatrixAt(existingIdx, this.hiddenScale);
        this.instancedMesh.instanceMatrix.needsUpdate = true;
        this.blockIndexMap.delete(key);
      }
    } else if (existingIdx !== undefined) {
      const color = new THREE.Color();
      const hue = (change.stateId * 137) % 360;
      color.setHSL(hue / 360, 0.6, 0.5);
      this.instancedMesh.setColorAt(existingIdx, color);
      if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
    } else if (this.instanceCount < this.maxInstances) {
      const idx = this.instanceCount++;
      this.instancedMesh.count = this.instanceCount;

      const matrix = new THREE.Matrix4();
      matrix.setPosition(change.x + 0.5, change.y + 0.5, change.z + 0.5);
      this.instancedMesh.setMatrixAt(idx, matrix);
      this.instancedMesh.instanceMatrix.needsUpdate = true;

      const color = new THREE.Color();
      const hue = (change.stateId * 137) % 360;
      color.setHSL(hue / 360, 0.6, 0.5);
      this.instancedMesh.setColorAt(idx, color);
      if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;

      this.blockIndexMap.set(key, idx);
    }
  }

  private startRenderLoop(): void {
    const render = () => {
      this.animationFrameId = requestAnimationFrame(render);
      this.updateExplosions();
      this.updateEntityAnimations();
      this.renderer?.render(this.scene, this.camera);
    };
    render();
  }

  /**
   * Update per-frame entity animations (e.g. dropped item rotation).
   */
  private updateEntityAnimations(): void {
    const now = performance.now() / 1000;
    this.entityMeshes.forEach((group, entityId) => {
      const typeName = this.entityTypeNames.get(entityId);
      if ((typeName && typeName.startsWith('item')) || typeName === 'dropped_item') {
        // Slow Y-axis rotation for dropped items
        const innerGroup = group.children[0];
        if (innerGroup && innerGroup.type !== 'Sprite') {
          innerGroup.rotation.y = now * 1.5;
        }
      }
    });
  }
}
