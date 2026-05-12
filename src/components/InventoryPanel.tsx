import React, { useRef, useEffect } from 'react';

export interface AtlasInfo {
  atlasImage: HTMLImageElement;
  textures: Record<string, { u: number; v: number; su: number; sv: number }>;
  items?: Record<string, { texture: string | null; isBlock: boolean }>;
  blockNameToState?: Record<string, number>;
  blocks?: Record<number, { top: string; side: string; bottom: string }>;
}

interface InventoryPanelProps {
  playerName: string;
  inventory: Map<number, { itemName: string; count: number; enchantments?: Array<{ id: string; level: number }> }>;
  onClose: () => void;
  atlas?: AtlasInfo | null;
}

// Slot layout: 0-8 = hotbar, 9-35 = main inventory, 36-39 = armor, 40 = offhand
export const SLOT_SIZE = 36;
const SLOT_GAP = 2;
export const ICON_SIZE = 28;

export function formatItemName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function formatEnchantName(id: string, level: number): string {
  const name = id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const numeral = level > 0 && level <= 10 ? ` ${ROMAN_NUMERALS[level]}` : level > 1 ? ` ${level}` : '';
  return `${name}${numeral}`;
}

// Simple color hash for item backgrounds
export function itemColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 40%, 35%)`;
}

// Runtime fallback texture mappings for items with animated/variant textures
export const ITEM_TEXTURE_FALLBACKS: Record<string, string> = {
  enchanted_golden_apple: 'item/golden_apple',
  crossbow: 'item/crossbow_standby',
  compass: 'item/compass_16',
  recovery_compass: 'item/recovery_compass_16',
  clock: 'item/clock_00',
  tipped_arrow: 'item/tipped_arrow_base',
  debug_stick: 'item/stick',
};

/**
 * Resolve atlas UV coords for an item name.
 */
export function getItemUV(itemName: string, atlas: AtlasInfo): { u: number; v: number; su: number; sv: number } | null {
  // Try via items mapping first
  if (atlas.items) {
    const itemInfo = atlas.items[itemName];
    if (itemInfo?.texture) {
      const uv = atlas.textures[itemInfo.texture];
      if (uv) return uv;
    }
  }

  // Try item/<name>
  const itemKey = `item/${itemName}`;
  if (atlas.textures[itemKey]) return atlas.textures[itemKey];

  // Try block/<name> (for block items like dirt, stone, etc.)
  const blockKey = `block/${itemName}`;
  if (atlas.textures[blockKey]) return atlas.textures[blockKey];

  // Try via blockNameToState → blocks → side texture
  if (atlas.blockNameToState && atlas.blocks) {
    const stateId = atlas.blockNameToState[itemName];
    if (stateId !== undefined) {
      const blockData = atlas.blocks[stateId];
      if (blockData) {
        const texName = blockData.side || blockData.top;
        if (texName && atlas.textures[texName]) return atlas.textures[texName];
      }
    }
  }

  // Try fallback mapping for animated/variant items
  const fallback = ITEM_TEXTURE_FALLBACKS[itemName];
  if (fallback && atlas.textures[fallback]) return atlas.textures[fallback];

  return null;
}

export const ItemIcon: React.FC<{ itemName: string; atlas: AtlasInfo }> = ({ itemName, atlas }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const uv = getItemUV(itemName, atlas);
    if (!uv) {
      ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
      return;
    }

    const img = atlas.atlasImage;
    const sx = uv.u * img.width;
    const sy = uv.v * img.height;
    const sw = uv.su * img.width;
    const sh = uv.sv * img.height;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, ICON_SIZE, ICON_SIZE);
  }, [itemName, atlas]);

  return (
    <canvas
      ref={canvasRef}
      width={ICON_SIZE}
      height={ICON_SIZE}
      style={{ width: ICON_SIZE, height: ICON_SIZE, imageRendering: 'pixelated' }}
    />
  );
};

export const SlotCell: React.FC<{
  slot: { itemName: string; count: number; enchantments?: Array<{ id: string; level: number }> } | undefined;
  label?: string;
  atlas?: AtlasInfo | null;
}> = ({ slot, label, atlas }) => {
  const hasIcon = slot && atlas && getItemUV(slot.itemName, atlas);

  const buildTitle = (): string => {
    if (!slot) return label || 'Empty';
    let title = `${formatItemName(slot.itemName)} x${slot.count}`;
    if (slot.enchantments && slot.enchantments.length > 0) {
      title += '\n' + slot.enchantments.map(e => formatEnchantName(e.id, e.level)).join('\n');
    }
    return title;
  };

  return (
    <div
      style={{
        width: SLOT_SIZE,
        height: SLOT_SIZE,
        backgroundColor: slot
          ? (hasIcon ? 'rgba(80, 80, 80, 0.5)' : itemColor(slot.itemName))
          : 'rgba(139, 139, 139, 0.2)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 2,
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: slot ? 'default' : undefined,
      }}
      title={buildTitle()}
    >
      {slot && (
        <>
          {hasIcon ? (
            <ItemIcon itemName={slot.itemName} atlas={atlas!} />
          ) : (
            <span style={{
              fontSize: 8,
              color: 'white',
              textAlign: 'center',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: SLOT_SIZE - 4,
              lineHeight: '10px',
            }}>
              {slot.itemName.split('_').pop()}
            </span>
          )}
          {slot.count > 1 && (
            <span style={{
              position: 'absolute',
              bottom: 1,
              right: 2,
              fontSize: 9,
              color: 'white',
              fontWeight: 'bold',
              textShadow: '1px 1px 1px rgba(0,0,0,0.8)',
            }}>
              {slot.count}
            </span>
          )}
        </>
      )}
      {!slot && label && (
        <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)' }}>{label}</span>
      )}
    </div>
  );
};

export const InventoryPanel: React.FC<InventoryPanelProps> = ({
  playerName,
  inventory,
  onClose,
  atlas,
}) => {
  const getSlot = (index: number) => inventory.get(index);

  return (
    <div style={{
      position: 'absolute',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      borderRadius: 8,
      padding: 16,
      zIndex: 10,
      fontFamily: 'system-ui, sans-serif',
      color: 'white',
      minWidth: 360,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 'bold' }}>{playerName}'s Inventory</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          &times;
        </button>
      </div>

      {/* Armor slots (36-39) + Offhand (40) */}
      <div style={{ display: 'flex', gap: SLOT_GAP, marginBottom: 8 }}>
        <SlotCell slot={getSlot(39)} label="Head" atlas={atlas} />
        <SlotCell slot={getSlot(38)} label="Chest" atlas={atlas} />
        <SlotCell slot={getSlot(37)} label="Legs" atlas={atlas} />
        <SlotCell slot={getSlot(36)} label="Feet" atlas={atlas} />
        <div style={{ width: SLOT_SIZE }} /> {/* spacer */}
        <SlotCell slot={getSlot(40)} label="Off" atlas={atlas} />
      </div>

      {/* Separator */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '6px 0' }} />

      {/* Main inventory (slots 9-35, 3 rows of 9) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: SLOT_GAP, marginBottom: 8 }}>
        {[0, 1, 2].map(row => (
          <div key={row} style={{ display: 'flex', gap: SLOT_GAP }}>
            {Array.from({ length: 9 }, (_, col) => {
              const slotIndex = 9 + row * 9 + col;
              return <SlotCell key={slotIndex} slot={getSlot(slotIndex)} atlas={atlas} />;
            })}
          </div>
        ))}
      </div>

      {/* Separator */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '6px 0' }} />

      {/* Hotbar (slots 0-8) */}
      <div style={{ display: 'flex', gap: SLOT_GAP }}>
        {Array.from({ length: 9 }, (_, i) => (
          <SlotCell key={i} slot={getSlot(i)} atlas={atlas} />
        ))}
      </div>
    </div>
  );
};
