import { ParsedReplay, ReplayEvent, EventType, AnimationType, PlayerSpawnEvent, PlayerMoveEvent, PlayerRemoveEvent, PlayerAnimEvent, PlayerEquipmentEvent, PlayerEquipmentFullEvent, PlayerHealthEvent, PlayerEffectsEvent, PlayerInventoryEvent, PlayerSkinEvent, EntitySpawnEvent, EntityMoveEvent, EntityRemoveEvent } from '../types/ReplayFile';
import { PlaybackState, PlaybackRate } from '../types/PlaybackState';
import { WorldState, BlockChange } from './WorldState';
import { interpolatePosition, lerpAngle, binarySearchTime } from './Interpolation';

export type EngineListener = (state: PlaybackState, changes: BlockChange[]) => void;

interface EntityState {
  entityId: number;
  entityTypeId: number;
  entityTypeName: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  alive: boolean;
}

interface PlayerState {
  uuid: string;
  playerName: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  alive: boolean;
  sneaking: boolean;
  lastSwingTime: number;
  lastDamageTime: number;
  skinUuid: string;
  heldItem: string;
  equipment: Map<number, { itemName: string; enchantments?: Array<{ id: string; level: number }> }>;
  health: number;
  food: number;
  saturation: number;
  effects: Array<{ effectTypeId: number; amplifier: number; durationTicks: number; appliedAtMs: number }>;
  inventory: Map<number, { itemName: string; count: number; enchantments?: Array<{ id: string; level: number }> }>;
}

export class ReplayEngine {
  private replay: ParsedReplay;
  private worldState: WorldState;
  private playing: boolean = false;
  private currentTimeMs: number = 0;
  private totalDurationMs: number = 0;
  private rate: PlaybackRate = 1;
  private followingPlayer: string | null = null;

  private listeners: Set<EngineListener> = new Set();
  private animationFrameId: number | null = null;
  private lastFrameTime: number | null = null;

  // Entity/player tracking
  private entities: Map<number, EntityState> = new Map();
  private players: Map<string, PlayerState> = new Map();
  // Embedded skin PNG data: uuid → Uint8Array
  private playerSkins: Map<string, Uint8Array> = new Map();

  // Per-entity/player move event indices for interpolation
  private playerMoveEvents: Map<string, (PlayerSpawnEvent | PlayerMoveEvent)[]> = new Map();
  private entityMoveEvents: Map<number, (EntitySpawnEvent | EntityMoveEvent)[]> = new Map();

  private currentEventIndex: number = 0;

  constructor(replay: ParsedReplay) {
    this.replay = replay;
    this.worldState = new WorldState(replay);

    // Compute total duration from last event
    if (replay.events.length > 0) {
      this.totalDurationMs = replay.events[replay.events.length - 1].timestampDeltaMs;
    }

    // Pre-index move events per entity/player
    this.buildMoveIndices();
  }

  private buildMoveIndices(): void {
    for (const event of this.replay.events) {
      if (event.type === EventType.PLAYER_SPAWN || event.type === EventType.PLAYER_MOVE) {
        const uuid = event.uuid;
        if (!this.playerMoveEvents.has(uuid)) {
          this.playerMoveEvents.set(uuid, []);
        }
        this.playerMoveEvents.get(uuid)!.push(event);
      }
      if (event.type === EventType.ENTITY_SPAWN || event.type === EventType.ENTITY_MOVE) {
        const entityId = event.type === EventType.ENTITY_SPAWN ? event.entityId : event.entityId;
        if (!this.entityMoveEvents.has(entityId)) {
          this.entityMoveEvents.set(entityId, []);
        }
        this.entityMoveEvents.get(entityId)!.push(event);
      }
    }
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.lastFrameTime = null;
    this.animationFrameId = requestAnimationFrame(this.tick);
    this.notifyListeners([]);
  }

  pause(): void {
    this.playing = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.lastFrameTime = null;
    this.notifyListeners([]);
  }

  seek(timeMs: number): void {
    this.currentTimeMs = Math.max(0, Math.min(timeMs, this.totalDurationMs));
    this.currentEventIndex = 0; // Reset — worldState handles seeking internally
    this.rebuildEntityState();
    const changes = this.worldState.advanceTo(this.currentTimeMs);
    this.notifyListeners(changes);
  }

  setRate(rate: PlaybackRate): void {
    this.rate = rate;
    this.notifyListeners([]);
  }

  followPlayer(uuid: string | null): void {
    this.followingPlayer = uuid;
    this.notifyListeners([]);
  }

  getState(): PlaybackState {
    return {
      playing: this.playing,
      currentTimeMs: this.currentTimeMs,
      totalDurationMs: this.totalDurationMs,
      rate: this.rate,
      followingPlayer: this.followingPlayer,
    };
  }

  getPlayers(): Map<string, PlayerState> {
    return new Map(this.players);
  }

  getPlayerSkin(uuid: string): Uint8Array | undefined {
    return this.playerSkins.get(uuid);
  }

  getEntities(): Map<number, EntityState> {
    return new Map(this.entities);
  }

  getWorldState(): WorldState {
    return this.worldState;
  }

  /** Get interpolated entity position at current time */
  getInterpolatedEntityPosition(entityId: number): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    const moveEvents = this.entityMoveEvents.get(entityId);
    if (!moveEvents || moveEvents.length === 0) return null;

    const idx = binarySearchTime(moveEvents, this.currentTimeMs);
    if (idx < 0) return null;

    const before = moveEvents[idx];
    const after = idx + 1 < moveEvents.length ? moveEvents[idx + 1] : null;

    const getYaw = (e: EntitySpawnEvent | EntityMoveEvent) => e.type === EventType.ENTITY_SPAWN ? 0 : e.yaw;
    const getPitch = (e: EntitySpawnEvent | EntityMoveEvent) => e.type === EventType.ENTITY_SPAWN ? 0 : e.pitch;

    if (!after || after.timestampDeltaMs <= this.currentTimeMs) {
      return { x: before.x, y: before.y, z: before.z, yaw: getYaw(before), pitch: getPitch(before) };
    }

    const pos = interpolatePosition(before, after, this.currentTimeMs);
    const range = after.timestampDeltaMs - before.timestampDeltaMs;
    const t = range > 0 ? (this.currentTimeMs - before.timestampDeltaMs) / range : 0;

    return {
      ...pos,
      yaw: lerpAngle(getYaw(before), getYaw(after), t),
      pitch: lerpAngle(getPitch(before), getPitch(after), t),
    };
  }

  /** Get interpolated player position at current time */
  getInterpolatedPlayerPosition(uuid: string): { x: number; y: number; z: number; yaw: number; pitch: number } | null {
    const moveEvents = this.playerMoveEvents.get(uuid);
    if (!moveEvents || moveEvents.length === 0) return null;

    const idx = binarySearchTime(moveEvents, this.currentTimeMs);
    if (idx < 0) return null;

    const before = moveEvents[idx];
    const after = idx + 1 < moveEvents.length ? moveEvents[idx + 1] : null;

    if (!after || after.timestampDeltaMs <= this.currentTimeMs) {
      return {
        x: before.x, y: before.y, z: before.z,
        yaw: before.yaw,
        pitch: before.pitch,
      };
    }

    const pos = interpolatePosition(
      { ...before, timestampDeltaMs: before.timestampDeltaMs },
      { ...after, timestampDeltaMs: after.timestampDeltaMs },
      this.currentTimeMs,
    );

    const range = after.timestampDeltaMs - before.timestampDeltaMs;
    const t = range > 0 ? (this.currentTimeMs - before.timestampDeltaMs) / range : 0;

    return {
      ...pos,
      yaw: lerpAngle(before.yaw, after.yaw, t),
      pitch: lerpAngle(before.pitch, after.pitch, t),
    };
  }

  private tick = (timestamp: number): void => {
    if (!this.playing) return;

    if (this.lastFrameTime !== null) {
      const realDelta = timestamp - this.lastFrameTime;
      const replayDelta = realDelta * this.rate;
      this.currentTimeMs = Math.min(this.currentTimeMs + replayDelta, this.totalDurationMs);

      // Process events and world state
      this.processEventsTo(this.currentTimeMs);
      const changes = this.worldState.advanceTo(this.currentTimeMs);
      this.notifyListeners(changes);

      // Auto-pause at end
      if (this.currentTimeMs >= this.totalDurationMs) {
        this.pause();
        return;
      }
    }

    this.lastFrameTime = timestamp;
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  private processEventsTo(timeMs: number): void {
    while (this.currentEventIndex < this.replay.events.length) {
      const event = this.replay.events[this.currentEventIndex];
      if (event.timestampDeltaMs > timeMs) break;

      this.applyEvent(event);
      this.currentEventIndex++;
    }
  }

  private applyEvent(event: ReplayEvent): void {
    switch (event.type) {
      case EventType.ENTITY_SPAWN: {
        let entityTypeName = '';
        if (event.metadata && event.metadata.length > 0) {
          try { entityTypeName = new TextDecoder().decode(event.metadata); } catch { /* ignore */ }
        }
        this.entities.set(event.entityId, {
          entityId: event.entityId,
          entityTypeId: event.entityTypeId,
          entityTypeName,
          x: event.x, y: event.y, z: event.z,
          yaw: 0, pitch: 0,
          alive: true,
        });
        break;
      }
      case EventType.ENTITY_MOVE: {
        const entity = this.entities.get(event.entityId);
        if (entity) {
          entity.x = event.x; entity.y = event.y; entity.z = event.z;
          entity.yaw = event.yaw;
          entity.pitch = event.pitch;
        }
        break;
      }
      case EventType.ENTITY_REMOVE:
        this.entities.delete(event.entityId);
        break;
      case EventType.PLAYER_SPAWN: {
        // Decode equipment bytes as UTF-8 UUID string for skin lookup
        let skinUuid = event.uuid;
        if (event.equipment && event.equipment.length > 0) {
          try {
            const decoded = new TextDecoder().decode(event.equipment);
            // Check if it matches UUID format (with or without dashes)
            if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(decoded)) {
              skinUuid = decoded;
            }
          } catch {
            // Fall back to event uuid
          }
        }
        this.players.set(event.uuid, {
          uuid: event.uuid,
          playerName: event.playerName,
          x: event.x, y: event.y, z: event.z,
          yaw: event.yaw,
          pitch: event.pitch,
          alive: true,
          sneaking: false,
          lastSwingTime: 0,
          lastDamageTime: 0,
          skinUuid,
          heldItem: '',
          equipment: new Map(),
          health: 20,
          food: 20,
          saturation: 5,
          effects: [],
          inventory: new Map(),
        });
        break;
      }
      case EventType.PLAYER_MOVE: {
        let player = this.players.get(event.uuid);
        if (!player) {
          // Auto-create player on first move if spawn was missing (e.g. evicted from rolling buffer)
          player = {
            uuid: event.uuid,
            playerName: 'Unknown',
            x: event.x, y: event.y, z: event.z,
            yaw: event.yaw,
            pitch: event.pitch,
            alive: true,
            sneaking: false,
            lastSwingTime: 0,
            lastDamageTime: 0,
            skinUuid: event.uuid,
            heldItem: '',
            equipment: new Map(),
            health: 20,
            food: 20,
            saturation: 5,
            effects: [],
            inventory: new Map(),
          };
          this.players.set(event.uuid, player);
        } else {
          player.x = event.x; player.y = event.y; player.z = event.z;
          player.yaw = event.yaw;
          player.pitch = event.pitch;
        }
        break;
      }
      case EventType.PLAYER_REMOVE:
        this.players.delete(event.uuid);
        break;
      case EventType.PLAYER_ANIM: {
        const player = this.players.get(event.uuid);
        if (player) {
          if (event.animationType === AnimationType.SWING_MAIN_ARM) {
            player.lastSwingTime = event.timestampDeltaMs;
          } else if (event.animationType === AnimationType.SNEAK_START) {
            player.sneaking = true;
          } else if (event.animationType === AnimationType.SNEAK_STOP) {
            player.sneaking = false;
          } else if (event.animationType === AnimationType.DAMAGE) {
            player.lastDamageTime = event.timestampDeltaMs;
          }
        }
        break;
      }
      case EventType.PLAYER_EQUIPMENT: {
        const player = this.players.get(event.uuid);
        if (player) {
          player.heldItem = event.itemName;
          player.equipment.set(0, { itemName: event.itemName }); // backward compat: slot 0 = main hand
        }
        break;
      }
      case EventType.PLAYER_EQUIPMENT_FULL: {
        const player = this.players.get(event.uuid);
        if (player) {
          player.equipment.clear();
          for (const slot of event.slots) {
            player.equipment.set(slot.slotId, { itemName: slot.itemName, enchantments: slot.enchantments });
          }
          // Keep heldItem in sync with main hand (slot 0)
          const mainHand = player.equipment.get(0);
          player.heldItem = mainHand?.itemName || '';
        }
        break;
      }
      case EventType.PLAYER_HEALTH: {
        const player = this.players.get(event.uuid);
        if (player) {
          player.health = event.health;
          player.food = event.food;
          player.saturation = event.saturation;
        }
        break;
      }
      case EventType.PLAYER_EFFECTS: {
        const player = this.players.get(event.uuid);
        if (player) {
          player.effects = event.effects.map(e => ({
            ...e,
            appliedAtMs: event.timestampDeltaMs,
          }));
        }
        break;
      }
      case EventType.PLAYER_INVENTORY: {
        const player = this.players.get(event.uuid);
        if (player) {
          if (event.isFullSnapshot) {
            player.inventory.clear();
          }
          for (const slot of event.slots) {
            if (slot.count === 0 || !slot.itemName) {
              player.inventory.delete(slot.slotIndex);
            } else {
              player.inventory.set(slot.slotIndex, { itemName: slot.itemName, count: slot.count, enchantments: slot.enchantments });
            }
          }
        }
        break;
      }
      case EventType.PLAYER_SKIN: {
        if (event.skinPng && event.skinPng.length > 0) {
          this.playerSkins.set(event.uuid, event.skinPng);
        }
        break;
      }
    }
  }

  private rebuildEntityState(): void {
    this.entities.clear();
    this.players.clear();
    this.currentEventIndex = 0;
    this.processEventsTo(this.currentTimeMs);
  }

  private notifyListeners(changes: BlockChange[]): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state, changes);
    }
  }

  dispose(): void {
    this.pause();
    this.listeners.clear();
  }
}
