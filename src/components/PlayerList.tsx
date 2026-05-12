import React, { useRef, useEffect } from 'react';
import {
  getItemUV,
  formatItemName,
  itemColor,
  type AtlasInfo,
} from './InventoryPanel';
import { computeHearts, computeDrumsticks } from './PlayerHUD';

// Minecraft potion effect type IDs → display names
const EFFECT_NAMES: Record<number, string> = {
  1: 'Speed', 2: 'Slowness', 3: 'Haste', 4: 'Mining Fatigue',
  5: 'Strength', 6: 'Instant Health', 7: 'Instant Damage',
  8: 'Jump Boost', 9: 'Nausea', 10: 'Regeneration',
  11: 'Resistance', 12: 'Fire Resistance', 13: 'Water Breathing',
  14: 'Invisibility', 15: 'Blindness', 16: 'Night Vision',
  17: 'Hunger', 18: 'Weakness', 19: 'Poison', 20: 'Wither',
  21: 'Health Boost', 22: 'Absorption', 23: 'Saturation',
  24: 'Glowing', 25: 'Levitation', 26: 'Luck', 27: 'Unluck',
  28: 'Slow Falling', 29: 'Conduit Power', 30: 'Dolphins Grace',
  31: 'Bad Omen', 32: 'Hero of the Village', 33: 'Darkness',
};

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function getEffectColor(effectTypeId: number): string {
  const positive = new Set([1, 3, 5, 6, 8, 10, 11, 12, 13, 16, 21, 22, 23, 26, 28, 29, 32]);
  const negative = new Set([2, 4, 7, 9, 15, 17, 18, 19, 20, 25, 27, 31, 33]);
  if (positive.has(effectTypeId)) return 'rgba(80, 200, 120, 0.7)';
  if (negative.has(effectTypeId)) return 'rgba(220, 80, 80, 0.7)';
  return 'rgba(100, 160, 220, 0.7)';
}

function formatDuration(ticks: number): string {
  const totalSeconds = Math.max(0, Math.floor(ticks / 20));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface EffectInfo {
  effectTypeId: number;
  amplifier: number;
  durationTicks: number;
  appliedAtMs: number;
}

interface PlayerInfo {
  uuid: string;
  playerName: string;
  effects?: EffectInfo[];
}

// Compact slot for sidebar (27px to fit 9 across in 256px)
const COMPACT_SLOT = 27;
const COMPACT_ICON = 22;

const CompactItemIcon: React.FC<{ itemName: string; atlas: AtlasInfo }> = ({ itemName, atlas }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const uv = getItemUV(itemName, atlas);
    if (!uv) { ctx.clearRect(0, 0, COMPACT_ICON, COMPACT_ICON); return; }
    const img = atlas.atlasImage;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, COMPACT_ICON, COMPACT_ICON);
    ctx.drawImage(img, uv.u * img.width, uv.v * img.height, uv.su * img.width, uv.sv * img.height, 0, 0, COMPACT_ICON, COMPACT_ICON);
  }, [itemName, atlas]);
  return <canvas ref={canvasRef} width={COMPACT_ICON} height={COMPACT_ICON} style={{ width: COMPACT_ICON, height: COMPACT_ICON, imageRendering: 'pixelated' }} />;
};

const CompactSlotCell: React.FC<{
  slot: { itemName: string; count: number } | undefined;
  label?: string;
  atlas?: AtlasInfo | null;
}> = ({ slot, label, atlas }) => {
  const hasIcon = slot && atlas && getItemUV(slot.itemName, atlas);
  return (
    <div
      style={{
        width: COMPACT_SLOT,
        height: COMPACT_SLOT,
        backgroundColor: slot
          ? (hasIcon ? 'rgba(80, 80, 80, 0.5)' : itemColor(slot.itemName))
          : 'rgba(139, 139, 139, 0.2)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 2,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      title={slot ? `${formatItemName(slot.itemName)} x${slot.count}` : label || 'Empty'}
    >
      {slot && (
        <>
          {hasIcon ? (
            <CompactItemIcon itemName={slot.itemName} atlas={atlas!} />
          ) : (
            <span style={{ fontSize: 6, color: 'white', textAlign: 'center', overflow: 'hidden', maxWidth: COMPACT_SLOT - 4, lineHeight: '8px' }}>
              {slot.itemName.split('_').pop()}
            </span>
          )}
          {slot.count > 1 && (
            <span style={{ position: 'absolute', bottom: 0, right: 1, fontSize: 7, color: 'white', fontWeight: 'bold', textShadow: '1px 1px 1px rgba(0,0,0,0.8)' }}>
              {slot.count}
            </span>
          )}
        </>
      )}
      {!slot && label && (
        <span style={{ fontSize: 6, color: 'rgba(255,255,255,0.3)' }}>{label}</span>
      )}
    </div>
  );
};

export interface PlayerState {
  uuid: string;
  playerName: string;
  health: number;
  food: number;
  saturation: number;
  effects: EffectInfo[];
  equipment: Map<number, { itemName: string; enchantments?: Array<{ id: string; level: number }> }>;
  inventory: Map<number, { itemName: string; count: number; enchantments?: Array<{ id: string; level: number }> }>;
}

interface PlayerSidebarProps {
  players: PlayerInfo[];
  followingPlayer: string | null;
  expandedPlayer: string | null;
  onFollowPlayer: (uuid: string | null) => void;
  onExpandPlayer: (uuid: string | null) => void;
  currentTimeMs?: number;
  visible?: boolean;
  selectedPlayerState?: PlayerState | null;
  atlas?: AtlasInfo | null;
}


const HealthBar: React.FC<{ health: number }> = ({ health }) => {
  const hearts = computeHearts(health);
  const heartColors = { full: '#cc3333', half: '#cc3333', empty: '#333333' };

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {hearts.map((state, i) => (
        <div
          key={i}
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            margin: '0 0.5px',
            borderRadius: 1,
            backgroundColor: heartColors[state],
            opacity: state === 'empty' ? 0.4 : 1,
            ...(state === 'half' ? {
              background: `linear-gradient(to right, ${heartColors.half} 50%, #333333 50%)`,
            } : {}),
          }}
        />
      ))}
      <span style={{ color: '#cc3333', fontSize: 10, marginLeft: 4 }}>
        {health.toFixed(0)}
      </span>
    </div>
  );
};

const FoodBar: React.FC<{ food: number }> = ({ food }) => {
  const drumsticks = computeDrumsticks(food);
  const foodColors = { full: '#b87333', half: '#b87333', empty: '#333333' };

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {drumsticks.map((state, i) => (
        <div
          key={i}
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            margin: '0 0.5px',
            borderRadius: 1,
            backgroundColor: foodColors[state],
            opacity: state === 'empty' ? 0.4 : 1,
            ...(state === 'half' ? {
              background: `linear-gradient(to right, ${foodColors.half} 50%, #333333 50%)`,
            } : {}),
          }}
        />
      ))}
      <span style={{ color: '#b87333', fontSize: 10, marginLeft: 4 }}>
        {food}
      </span>
    </div>
  );
};

const PlayerDetail: React.FC<{
  playerState: PlayerState;
  currentTimeMs: number;
  atlas?: AtlasInfo | null;
  isFollowing: boolean;
  onFollow: () => void;
  onUnfollow: () => void;
}> = ({ playerState, currentTimeMs, atlas, isFollowing, onFollow, onUnfollow }) => {
  const getSlot = (index: number) => playerState.inventory.get(index);
  const activeEffects = playerState.effects.filter((e) => {
    const elapsedMs = currentTimeMs - e.appliedAtMs;
    const elapsedTicks = Math.floor(elapsedMs / 50);
    return e.durationTicks - elapsedTicks > 0;
  });

  return (
    <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      {/* Follow/Unfollow button */}
      <button
        onClick={isFollowing ? onUnfollow : onFollow}
        style={{
          width: '100%',
          padding: '5px 10px',
          marginBottom: 8,
          background: isFollowing ? 'rgba(99, 102, 241, 0.3)' : 'rgba(99, 102, 241, 0.15)',
          border: '1px solid rgba(99, 102, 241, 0.3)',
          borderRadius: 6,
          color: 'white',
          fontSize: 11,
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
      >
        {isFollowing ? 'Unfollow' : 'Follow Camera'}
      </button>

      {/* Health & Food */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
        <HealthBar health={playerState.health} />
        <FoodBar food={playerState.food} />
      </div>

      {/* Equipment strip */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Equipment
        </div>
        <div style={{ display: 'flex', gap: 1 }}>
          <CompactSlotCell slot={getSlot(39)} label="Head" atlas={atlas} />
          <CompactSlotCell slot={getSlot(38)} label="Chest" atlas={atlas} />
          <CompactSlotCell slot={getSlot(37)} label="Legs" atlas={atlas} />
          <CompactSlotCell slot={getSlot(36)} label="Feet" atlas={atlas} />
          <div style={{ width: 4 }} />
          <CompactSlotCell slot={getSlot(40)} label="Off" atlas={atlas} />
        </div>
      </div>

      {/* Potion effects */}
      {activeEffects.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Effects
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {activeEffects.map((effect, i) => {
              const name = EFFECT_NAMES[effect.effectTypeId] || `Effect ${effect.effectTypeId}`;
              const level = effect.amplifier < ROMAN_NUMERALS.length
                ? ROMAN_NUMERALS[effect.amplifier]
                : `${effect.amplifier + 1}`;
              const elapsedMs = currentTimeMs - effect.appliedAtMs;
              const elapsedTicks = Math.floor(elapsedMs / 50);
              const remainingTicks = Math.max(0, effect.durationTicks - elapsedTicks);
              return (
                <span key={i} style={{
                  fontSize: 9,
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.06)',
                  color: getEffectColor(effect.effectTypeId),
                  whiteSpace: 'nowrap',
                }}>
                  {name} {level} {formatDuration(remainingTicks)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Inventory grid */}
      <div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Inventory
        </div>
        {/* Main inventory (9-35) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, marginBottom: 4 }}>
          {[0, 1, 2].map((row) => (
            <div key={row} style={{ display: 'flex', gap: 1 }}>
              {Array.from({ length: 9 }, (_, col) => {
                const slotIndex = 9 + row * 9 + col;
                return <CompactSlotCell key={slotIndex} slot={getSlot(slotIndex)} atlas={atlas} />;
              })}
            </div>
          ))}
        </div>
        {/* Separator */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', margin: '3px 0' }} />
        {/* Hotbar (0-8) */}
        <div style={{ display: 'flex', gap: 1 }}>
          {Array.from({ length: 9 }, (_, i) => (
            <CompactSlotCell key={i} slot={getSlot(i)} atlas={atlas} />
          ))}
        </div>
      </div>
    </div>
  );
};

export const PlayerSidebar: React.FC<PlayerSidebarProps> = ({
  players,
  followingPlayer,
  expandedPlayer,
  onFollowPlayer,
  onExpandPlayer,
  currentTimeMs = 0,
  visible = true,
  selectedPlayerState,
  atlas,
}) => {
  if (players.length === 0) return null;

  return (
    <div style={{
      position: 'absolute',
      top: 16,
      right: 16,
      bottom: 80,
      width: 280,
      background: 'rgba(15, 15, 30, 0.5)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: 12,
      overflowY: 'auto',
      fontFamily: 'system-ui, sans-serif',
      color: 'white',
      fontSize: 13,
      zIndex: 5,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateX(0)' : 'translateX(12px)',
      transition: 'opacity 0.3s ease, transform 0.3s ease',
      pointerEvents: visible ? 'auto' : 'none',
    }}>
      <div style={{
        padding: '10px 12px 6px',
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        opacity: 0.5,
      }}>
        Players
      </div>
      {players.map((player) => {
        const isFollowing = followingPlayer === player.uuid;
        const isExpanded = expandedPlayer === player.uuid;
        const activeEffects = (player.effects || []).filter((e) => {
          const elapsedMs = currentTimeMs - e.appliedAtMs;
          const elapsedTicks = Math.floor(elapsedMs / 50);
          return e.durationTicks - elapsedTicks > 0;
        });

        return (
          <div key={player.uuid}>
            <button
              onClick={() => onExpandPlayer(isExpanded ? null : player.uuid)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '6px 12px',
                background: isExpanded ? 'rgba(99, 102, 241, 0.2)' : 'none',
                border: 'none',
                color: 'white',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: 13,
                transition: 'background 0.15s',
              }}
              title={isExpanded ? 'Collapse' : `Expand ${player.playerName}`}
            >
              <span>{player.playerName}</span>
              {isFollowing && (
                <span style={{ opacity: 0.5, fontSize: 10 }}>following</span>
              )}
              {!isFollowing && activeEffects.length > 0 && (
                <span style={{ opacity: 0.4, fontSize: 10 }}>
                  {activeEffects.length} effect{activeEffects.length > 1 ? 's' : ''}
                </span>
              )}
            </button>
            {/* Expanded detail for selected player */}
            {isExpanded && selectedPlayerState && selectedPlayerState.uuid === player.uuid && (
              <PlayerDetail
                playerState={selectedPlayerState}
                currentTimeMs={currentTimeMs}
                atlas={atlas}
                isFollowing={isFollowing}
                onFollow={() => onFollowPlayer(player.uuid)}
                onUnfollow={() => onFollowPlayer(null)}
              />
            )}
          </div>
        );
      })}
      {followingPlayer && (
        <button
          onClick={() => onFollowPlayer(null)}
          style={{
            display: 'block',
            width: '100%',
            padding: '6px 12px',
            marginTop: 4,
            background: 'none',
            border: 'none',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            color: 'rgba(255,255,255,0.5)',
            textAlign: 'center',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Free camera
        </button>
      )}
    </div>
  );
};

// Backwards compatibility alias
export const PlayerList = PlayerSidebar;
