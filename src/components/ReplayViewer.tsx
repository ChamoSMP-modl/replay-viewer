import React, { useRef, useEffect, useState, useCallback } from 'react';
import { parseReplayAsync } from '../engine/ReplayParser';
import { ReplayEngine } from '../engine/ReplayEngine';
import { PrismarineRenderer, AtlasMapping } from '../renderer/PrismarineRenderer';
import { CameraController } from '../renderer/CameraController';
import { resolveAtlasVersion, VersionManifest } from '../engine/VersionResolver';
import { PlaybackState, PlaybackRate } from '../types/PlaybackState';
import { EventType } from '../types/ReplayFile';
import type { PlayerLabel } from '../types/labeling';
import { TimelineControls } from './TimelineControls';
import { PlayerSidebar, type PlayerState } from './PlayerList';
import { LoadingOverlay } from './LoadingOverlay';
import { InfoButton } from './InfoButton';
import { InfoSidebar } from './InfoSidebar';
import type { AtlasInfo } from './InventoryPanel';

export interface ReplayViewerProps {
  /** URL to fetch the .modlreplay file from (e.g., presigned B2 URL) */
  replayUrl: string;
  /** Minecraft version for block rendering (e.g., "1.21.4") */
  mcVersion: string;
  /** URL to the texture atlas PNG (e.g., "/atlas.png") — overrides auto-resolution */
  atlasUrl?: string;
  /** URL to the atlas mapping JSON (e.g., "/atlas-data.json") — overrides auto-resolution */
  atlasMappingUrl?: string;
  /** Base URL for versioned atlas directory (default: "/atlas") */
  atlasBaseUrl?: string;
  /** Called when the replay has been loaded and is ready to play */
  onLoad?: () => void;
  /** Called when an error occurs during loading or playback */
  onError?: (error: Error) => void;
  /** Replay identifier for info display and label submission */
  replayId?: string;
  /** Base URL for label submission API (e.g., "https://replay-api.modl.gg"). When set, the viewer POSTs labels directly. */
  labelApiUrl?: string;
  /** Called when user submits labels via the labeling wizard */
  onLabelSubmit?: (labels: PlayerLabel[]) => void;
  /** Whether the replay has already been labeled (hides labeling wizard) */
  labeled?: boolean;
}

interface PlayerInfo {
  uuid: string;
  playerName: string;
  effects?: Array<{ effectTypeId: number; amplifier: number; durationTicks: number; appliedAtMs: number }>;
}

const defaultPlaybackState: PlaybackState = {
  playing: false,
  currentTimeMs: 0,
  totalDurationMs: 0,
  rate: 1,
  followingPlayer: null,
};

const AUTO_HIDE_MS = 3000;

export const ReplayViewer: React.FC<ReplayViewerProps> = ({
  replayUrl,
  mcVersion,
  atlasUrl,
  atlasMappingUrl,
  atlasBaseUrl = '/atlas',
  onLoad,
  onError,
  replayId,
  labelApiUrl,
  onLabelSubmit,
  labeled,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ReplayEngine | null>(null);
  const rendererRef = useRef<PrismarineRenderer | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const entityTypeNamesRef = useRef<Map<number, string>>(new Map());

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>(defaultPlaybackState);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [atlasInfo, setAtlasInfo] = useState<AtlasInfo | null>(null);
  const [selectedPlayerState, setSelectedPlayerState] = useState<PlayerState | null>(null);
  const selectedPlayerRef = useRef<string | null>(null);

  // UI visibility state
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showInfo, setShowInfo] = useState(false);
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Ref for playback state (avoid stale closures in keyboard handler)
  const playbackStateRef = useRef(playbackState);
  playbackStateRef.current = playbackState;

  // Auto-hide controls
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resetTimer = () => {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        if (!showInfo) {
          setControlsVisible(false);
        }
      }, AUTO_HIDE_MS);
    };

    const handleMouseMove = () => resetTimer();
    const handleMouseLeave = () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (!showInfo) {
        setControlsVisible(false);
      }
    };

    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);
    resetTimer();

    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [showInfo]);

  // Keep controls visible when sidebar is open
  useEffect(() => {
    if (showInfo) {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, [showInfo]);

  // Fetch + parse + initialize
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Fetch the replay file
        const response = await fetch(replayUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch replay: ${response.status} ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        if (cancelled) return;

        // Parse the binary data
        const parsed = await parseReplayAsync(buffer);
        if (cancelled) return;

        // Debug: log parsed replay info
        console.log('[ReplayViewer] Parsed replay:', {
          header: parsed.header,
          snapshotBlocks: parsed.snapshot.length,
          events: parsed.events.length,
          firstBlocks: parsed.snapshot.slice(0, 5),
        });

        // Create engine
        const engine = new ReplayEngine(parsed);
        engineRef.current = engine;

        // Create renderer
        const renderer = new PrismarineRenderer(mcVersion);
        rendererRef.current = renderer;

        if (containerRef.current) {
          // Load atlas: explicit URLs take priority, otherwise auto-resolve from version
          let resolvedAtlasUrl = atlasUrl;
          let resolvedMappingUrl = atlasMappingUrl;

          if (!resolvedAtlasUrl || !resolvedMappingUrl) {
            try {
              const replayMcVersion = parsed.header.mcVersion || mcVersion;
              const manifestResp = await fetch(`${atlasBaseUrl}/versions.json`);
              if (manifestResp.ok) {
                const manifest: VersionManifest = await manifestResp.json();
                const bestVersion = resolveAtlasVersion(replayMcVersion, manifest);
                resolvedAtlasUrl = resolvedAtlasUrl || `${atlasBaseUrl}/${bestVersion}/atlas.png`;
                resolvedMappingUrl = resolvedMappingUrl || `${atlasBaseUrl}/${bestVersion}/atlas-data.json`;
                console.log(`[ReplayViewer] Auto-resolved atlas version: ${bestVersion} (replay MC: ${replayMcVersion})`);
              }
            } catch (e) {
              console.warn('Failed to fetch atlas version manifest:', e);
            }
          }

          if (resolvedAtlasUrl && resolvedMappingUrl) {
            try {
              const mappingResp = await fetch(resolvedMappingUrl);
              if (mappingResp.ok) {
                const mapping: AtlasMapping = await mappingResp.json();
                if (cancelled) return;
                await renderer.setTextureAtlas(resolvedAtlasUrl, mapping);

                // Load atlas image for inventory panel icons
                const atlasImg = new Image();
                atlasImg.crossOrigin = 'anonymous';
                atlasImg.src = resolvedAtlasUrl;
                atlasImg.onload = () => {
                  if (!cancelled) {
                    setAtlasInfo({
                      atlasImage: atlasImg,
                      textures: mapping.textures,
                      items: mapping.items,
                      blockNameToState: mapping.blockNameToState,
                      blocks: mapping.blocks,
                    });
                  }
                };
              }
            } catch (e) {
              console.warn('Failed to load texture atlas, falling back to basic rendering:', e);
            }
          }

          await renderer.init(containerRef.current);
          if (cancelled) return;

          // Load initial snapshot (async — yields to browser between section batches)
          await renderer.loadSnapshot(parsed.snapshot);

          // Create camera controller
          const canvas = renderer.getDomElement();
          if (canvas) {
            const controller = new CameraController(renderer.getCamera(), canvas);
            cameraControllerRef.current = controller;

            // Position camera above the first player spawn, or fallback to header target / block centroid
            let cx = parsed.header.targetX;
            let cy = parsed.header.targetY;
            let cz = parsed.header.targetZ;

            // Find first player spawn event for camera position
            const firstSpawn = parsed.events.find(e => e.type === EventType.PLAYER_SPAWN) as import('../types/ReplayFile').PlayerSpawnEvent | undefined;
            if (firstSpawn) {
              cx = firstSpawn.x;
              cy = firstSpawn.y;
              cz = firstSpawn.z;
            } else if (cx === 0 && cy === 0 && cz === 0 && parsed.snapshot.length > 0) {
              // Fallback: centroid from snapshot blocks
              let sx = 0, sy = 0, sz = 0;
              for (const b of parsed.snapshot) {
                sx += b.x; sy += b.y; sz += b.z;
              }
              cx = sx / parsed.snapshot.length;
              cy = sy / parsed.snapshot.length;
              cz = sz / parsed.snapshot.length;
            }

            renderer.getCamera().position.set(cx - 10, cy + 15, cz + 10);
            renderer.getCamera().lookAt(cx, cy, cz);
          }
        }

        // Subscribe to engine updates
        engine.subscribe((state, changes) => {
          if (cancelled) return;
          setPlaybackState(state);

          // Apply block changes to renderer
          if (changes.length > 0 && rendererRef.current) {
            rendererRef.current.applyBlockChanges(changes);
          }

          // Update players in renderer and player list
          const playerMap = engine.getPlayers();
          const playerInfos: PlayerInfo[] = [];
          const r = rendererRef.current;
          playerMap.forEach((p) => {
            if (p.alive) {
              playerInfos.push({ uuid: p.uuid, playerName: p.playerName, effects: p.effects });
              // Pass embedded skin data to renderer if available
              const skinData = engine.getPlayerSkin(p.uuid);
              if (skinData && r) {
                r.setEmbeddedSkin(p.uuid, skinData);
                // Also set for the skinUuid key (may differ from uuid)
                if (p.skinUuid && p.skinUuid !== p.uuid) {
                  r.setEmbeddedSkin(p.skinUuid, skinData);
                }
              }
              const interp = engine.getInterpolatedPlayerPosition(p.uuid);
              const pos = interp || { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch };
              r?.updatePlayer(
                p.uuid, p.playerName,
                pos.x, pos.y, pos.z, pos.yaw, pos.pitch,
                p.sneaking, p.lastSwingTime, state.currentTimeMs,
                p.skinUuid, p.heldItem, p.lastDamageTime,
                p.equipment, p.health,
              );
            } else {
              r?.removePlayer(p.uuid);
            }
          });
          setPlayers(playerInfos);

          // Update entities in renderer
          if (r) {
            const entityMap = engine.getEntities();
            const activeEntityIds = new Set<number>();
            entityMap.forEach((e) => {
              activeEntityIds.add(e.entityId);
              entityTypeNamesRef.current.set(e.entityId, e.entityTypeName);
              const interp = engine.getInterpolatedEntityPosition(e.entityId);
              const epos = interp || { x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch };
              r.updateEntity(e.entityId, epos.x, epos.y, epos.z, epos.yaw, epos.pitch, e.entityTypeName);
            });
            // Remove entities no longer active
            const knownIds = r.getKnownEntityIds();
            knownIds.forEach((id) => {
              if (!activeEntityIds.has(id)) {
                const typeName = entityTypeNamesRef.current.get(id);
                r.removeEntity(id, typeName);
                entityTypeNamesRef.current.delete(id);
              }
            });
          }

          // Update selected player state for sidebar detail
          if (selectedPlayerRef.current) {
            const selected = playerMap.get(selectedPlayerRef.current);
            if (selected) {
              setSelectedPlayerState({
                uuid: selected.uuid,
                playerName: selected.playerName,
                health: selected.health,
                food: selected.food,
                saturation: selected.saturation,
                effects: selected.effects,
                equipment: new Map(selected.equipment),
                inventory: new Map(selected.inventory),
              });
            }
          }

          // Update camera follow
          if (state.followingPlayer && cameraControllerRef.current) {
            const pos = engine.getInterpolatedPlayerPosition(state.followingPlayer);
            if (pos) {
              cameraControllerRef.current.setMode('follow');
              cameraControllerRef.current.setFollowTarget(pos);
            }
          }
        });

        // Render initial state (t=0 player spawns) before user presses play
        engine.seek(0);

        // Show viewer immediately — skins load in background
        setLoading(false);
        onLoad?.();

        // Preload embedded skins in background (non-blocking)
        if (renderer) {
          renderer.preloadEmbeddedSkins().catch(() => { /* ignore skin errors */ });
        }
      } catch (err) {
        if (cancelled) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error.message);
        setLoading(false);
        onError?.(error);
      }
    }

    load();

    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      rendererRef.current?.dispose();
      cameraControllerRef.current?.dispose();
    };
  }, [replayUrl, mcVersion, atlasUrl, atlasMappingUrl, atlasBaseUrl, onLoad, onError]);

  // Handle resize — both window resize and container layout changes
  useEffect(() => {
    const handleResize = () => rendererRef.current?.updateSize();
    window.addEventListener('resize', handleResize);

    const container = containerRef.current;
    let observer: ResizeObserver | null = null;
    if (container) {
      observer = new ResizeObserver(() => rendererRef.current?.updateSize());
      observer.observe(container);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
    };
  }, []);

  // Camera update loop
  useEffect(() => {
    let lastTime = performance.now();
    let frameId: number;

    const update = (time: number) => {
      const dt = (time - lastTime) / 1000;
      lastTime = time;
      cameraControllerRef.current?.update(dt);
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, []);

  // Auto-expand first player when players become available
  useEffect(() => {
    if (players.length > 0 && expandedPlayer === null) {
      const firstUuid = players[0].uuid;
      setExpandedPlayer(firstUuid);
      selectedPlayerRef.current = firstUuid;
    }
  }, [players, expandedPlayer]);

  const handlePlay = useCallback(() => engineRef.current?.play(), []);
  const handlePause = useCallback(() => engineRef.current?.pause(), []);
  const handleSeek = useCallback((timeMs: number) => {
    rendererRef.current?.resetPlayerState();
    engineRef.current?.seek(timeMs);
    // Debug: log post-seek equipment state
    const ps = engineRef.current?.getPlayers();
    if (ps) {
      ps.forEach((p, uuid) => {
        const eqStr = Array.from(p.equipment.entries()).map(([k,v]) => `${k}:${typeof v === 'string' ? v : v.itemName}`).join(',');
        console.log(`[PostSeek] t=${timeMs.toFixed(0)} player=${p.playerName} equip=[${eqStr}]`);
      });
    }
  }, []);
  const handleRateChange = useCallback((rate: PlaybackRate) => engineRef.current?.setRate(rate), []);

  const handleFollowPlayer = useCallback((uuid: string | null) => {
    engineRef.current?.followPlayer(uuid);
    if (uuid) {
      cameraControllerRef.current?.setMode('follow');
    } else {
      cameraControllerRef.current?.setMode('free');
    }
  }, []);

  const handleExpandPlayer = useCallback((uuid: string | null) => {
    setExpandedPlayer(uuid);
    selectedPlayerRef.current = uuid;
    if (uuid) {
      // Immediately populate selected player state
      const playerMap = engineRef.current?.getPlayers();
      if (playerMap) {
        const player = playerMap.get(uuid);
        if (player) {
          setSelectedPlayerState({
            uuid: player.uuid,
            playerName: player.playerName,
            health: player.health,
            food: player.food,
            saturation: player.saturation,
            effects: player.effects,
            equipment: new Map(player.equipment),
            inventory: new Map(player.inventory),
          });
        }
      }
    } else {
      setSelectedPlayerState(null);
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const ps = playbackStateRef.current;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (ps.playing) handlePause();
          else handlePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          handleSeek(Math.min(ps.totalDurationMs, ps.currentTimeMs + 5000));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          handleSeek(Math.max(0, ps.currentTimeMs - 5000));
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handlePlay, handlePause, handleSeek]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        backgroundColor: '#1a1a2e',
        cursor: controlsVisible ? 'default' : 'none',
      }}
    >
      {loading && <LoadingOverlay />}
      {error && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          color: '#ef4444',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
          zIndex: 10,
          padding: 24,
          textAlign: 'center',
        }}>
          Failed to load replay: {error}
        </div>
      )}
      {!loading && !error && (
        <>
          {/* Info button — top-left (hidden when sidebar is open) */}
          <InfoButton onClick={() => setShowInfo(v => !v)} visible={controlsVisible && !showInfo} />

          {/* Info sidebar — left */}
          {showInfo && (
            <InfoSidebar
              replayId={replayId}
              duration={playbackState.totalDurationMs}
              playerCount={players.length}
              playerNames={players.map(p => p.playerName)}
              onClose={() => setShowInfo(false)}
              players={players}
              currentTimeMs={playbackState.currentTimeMs}
              totalDurationMs={playbackState.totalDurationMs}
              onLabelSubmit={onLabelSubmit}
              labelApiUrl={labelApiUrl}
              labeled={labeled}
            />
          )}

          {/* Player sidebar — right */}
          <PlayerSidebar
            players={players}
            followingPlayer={playbackState.followingPlayer}
            expandedPlayer={expandedPlayer}
            onFollowPlayer={handleFollowPlayer}
            onExpandPlayer={handleExpandPlayer}
            currentTimeMs={playbackState.currentTimeMs}
            visible={controlsVisible}
            selectedPlayerState={selectedPlayerState}
            atlas={atlasInfo}
          />

          {/* Timeline controls — bottom center */}
          <TimelineControls
            state={playbackState}
            onPlay={handlePlay}
            onPause={handlePause}
            onSeek={handleSeek}
            onRateChange={handleRateChange}
            visible={controlsVisible}
          />
        </>
      )}
    </div>
  );
};
