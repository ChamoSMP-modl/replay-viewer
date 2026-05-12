import React from 'react';

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

interface PlayerHUDProps {
  health: number;
  food: number;
  saturation: number;
  effects: Array<{ effectTypeId: number; amplifier: number; durationTicks: number; appliedAtMs: number }>;
  currentTimeMs: number;
}

function formatDuration(ticks: number): string {
  const totalSeconds = Math.max(0, Math.floor(ticks / 20));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const heartStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 9,
  height: 9,
  margin: '0 0.5px',
  borderRadius: 1,
};

const drumstickStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 9,
  height: 9,
  margin: '0 0.5px',
  borderRadius: 1,
};

export function computeHearts(health: number): ('full' | 'half' | 'empty')[] {
  const hearts: ('full' | 'half' | 'empty')[] = [];
  for (let i = 0; i < 10; i++) {
    const hp = health - i * 2;
    if (hp >= 2) hearts.push('full');
    else if (hp >= 1) hearts.push('half');
    else hearts.push('empty');
  }
  return hearts;
}

export function computeDrumsticks(food: number): ('full' | 'half' | 'empty')[] {
  const drumsticks: ('full' | 'half' | 'empty')[] = [];
  for (let i = 0; i < 10; i++) {
    const fp = food - i * 2;
    if (fp >= 2) drumsticks.push('full');
    else if (fp >= 1) drumsticks.push('half');
    else drumsticks.push('empty');
  }
  return drumsticks;
}

export const PlayerHUD: React.FC<PlayerHUDProps> = ({
  health,
  food,
  saturation,
  effects,
  currentTimeMs,
}) => {
  // Health: 20 max = 10 hearts, each heart = 2 HP
  const hearts: ('full' | 'half' | 'empty')[] = [];
  for (let i = 0; i < 10; i++) {
    const hp = health - i * 2;
    if (hp >= 2) hearts.push('full');
    else if (hp >= 1) hearts.push('half');
    else hearts.push('empty');
  }

  // Food: 20 max = 10 drumsticks
  const drumsticks: ('full' | 'half' | 'empty')[] = [];
  for (let i = 0; i < 10; i++) {
    const fp = food - i * 2;
    if (fp >= 2) drumsticks.push('full');
    else if (fp >= 1) drumsticks.push('half');
    else drumsticks.push('empty');
  }

  const heartColors = { full: '#cc3333', half: '#cc3333', empty: '#333333' };
  const foodColors = { full: '#b87333', half: '#b87333', empty: '#333333' };

  return (
    <div style={{
      position: 'absolute',
      bottom: 60,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 4,
      zIndex: 5,
      pointerEvents: 'none',
    }}>
      {/* Active effects */}
      {effects.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 6,
          marginBottom: 4,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}>
          {effects.map((effect, i) => {
            const name = EFFECT_NAMES[effect.effectTypeId] || `Effect ${effect.effectTypeId}`;
            const level = effect.amplifier < ROMAN_NUMERALS.length
              ? ROMAN_NUMERALS[effect.amplifier]
              : `${effect.amplifier + 1}`;
            // Estimate remaining ticks based on time elapsed since applied
            const elapsedMs = currentTimeMs - effect.appliedAtMs;
            const elapsedTicks = Math.floor(elapsedMs / 50);
            const remainingTicks = Math.max(0, effect.durationTicks - elapsedTicks);

            return (
              <div key={i} style={{
                backgroundColor: 'rgba(0, 0, 0, 0.65)',
                borderRadius: 4,
                padding: '2px 6px',
                color: 'white',
                fontSize: 11,
                fontFamily: 'system-ui, sans-serif',
                whiteSpace: 'nowrap',
              }}>
                {name} {level} {formatDuration(remainingTicks)}
              </div>
            );
          })}
        </div>
      )}

      {/* Hearts and food */}
      <div style={{
        display: 'flex',
        gap: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        borderRadius: 6,
        padding: '4px 8px',
      }}>
        {/* Hearts */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {hearts.map((state, i) => (
            <div key={`h${i}`} style={{
              ...heartStyle,
              backgroundColor: heartColors[state],
              opacity: state === 'empty' ? 0.4 : 1,
              ...(state === 'half' ? {
                background: `linear-gradient(to right, ${heartColors.half} 50%, #333333 50%)`,
              } : {}),
            }} />
          ))}
          <span style={{ color: '#cc3333', fontSize: 11, marginLeft: 4, fontFamily: 'system-ui, sans-serif' }}>
            {health.toFixed(0)}
          </span>
        </div>

        {/* Food */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {drumsticks.map((state, i) => (
            <div key={`f${i}`} style={{
              ...drumstickStyle,
              backgroundColor: foodColors[state],
              opacity: state === 'empty' ? 0.4 : 1,
              ...(state === 'half' ? {
                background: `linear-gradient(to right, ${foodColors.half} 50%, #333333 50%)`,
              } : {}),
            }} />
          ))}
          <span style={{ color: '#b87333', fontSize: 11, marginLeft: 4, fontFamily: 'system-ui, sans-serif' }}>
            {food}
          </span>
        </div>
      </div>
    </div>
  );
};
