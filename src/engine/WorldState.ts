import { BlockSnapshot, ReplayEvent, EventType, BlockChangeEvent, ParsedReplay } from '../types/ReplayFile';

/**
 * Manages world block state, supporting forward/backward seeking.
 * Entity/player state is handled separately by ReplayEngine.
 */
export class WorldState {
  /** Initial snapshot blocks, keyed by "x,y,z" */
  private initialBlocks: Map<string, number>;
  /** Current block states, keyed by "x,y,z" */
  private currentBlocks: Map<string, number>;
  /** Block change events sorted by timestamp */
  private blockChanges: BlockChangeEvent[];
  /** Current index into blockChanges (events up to this index have been applied) */
  private currentIndex: number = 0;

  constructor(replay: ParsedReplay) {
    this.initialBlocks = new Map();
    this.currentBlocks = new Map();

    for (const block of replay.snapshot) {
      const key = `${block.x},${block.y},${block.z}`;
      this.initialBlocks.set(key, block.stateId);
      this.currentBlocks.set(key, block.stateId);
    }

    this.blockChanges = replay.events.filter(
      (e): e is BlockChangeEvent => e.type === EventType.BLOCK_CHANGE
    );
  }

  /**
   * Advance or rewind world state to the given timestamp.
   * Returns the list of blocks that changed since the last call.
   */
  advanceTo(timeMs: number): BlockChange[] {
    const changes: BlockChange[] = [];

    if (this.needsReset(timeMs)) {
      // Backward seek or large jump — reset to initial snapshot and replay
      return this.resetAndReplayTo(timeMs);
    }

    // Forward seek — apply events from currentIndex to target
    while (this.currentIndex < this.blockChanges.length) {
      const event = this.blockChanges[this.currentIndex];
      if (event.timestampDeltaMs > timeMs) break;

      const key = `${event.x},${event.y},${event.z}`;
      this.currentBlocks.set(key, event.stateId);
      changes.push({ x: event.x, y: event.y, z: event.z, stateId: event.stateId });
      this.currentIndex++;
    }

    return changes;
  }

  private needsReset(targetTimeMs: number): boolean {
    if (this.currentIndex === 0) return false;
    // Need reset if seeking backward
    const lastAppliedTime = this.currentIndex > 0
      ? this.blockChanges[this.currentIndex - 1].timestampDeltaMs
      : 0;
    return targetTimeMs < lastAppliedTime;
  }

  private resetAndReplayTo(timeMs: number): BlockChange[] {
    // Reset to initial snapshot
    this.currentBlocks = new Map(this.initialBlocks);
    this.currentIndex = 0;

    // Replay all block changes up to timeMs
    return this.advanceTo(timeMs);
  }

  /** Get the current state ID of a block, or undefined if not in snapshot */
  getBlockState(x: number, y: number, z: number): number | undefined {
    return this.currentBlocks.get(`${x},${y},${z}`);
  }

  /** Get all current blocks (for initial rendering) */
  getAllBlocks(): BlockSnapshot[] {
    const blocks: BlockSnapshot[] = [];
    for (const [key, stateId] of this.currentBlocks) {
      const [x, y, z] = key.split(',').map(Number);
      blocks.push({ x, y, z, stateId });
    }
    return blocks;
  }
}

export interface BlockChange {
  x: number;
  y: number;
  z: number;
  stateId: number;
}
