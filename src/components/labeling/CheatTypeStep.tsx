import React from 'react';
import type { CheatType } from '../../types/labeling';

const CHEAT_OPTIONS: { type: CheatType; label: string }[] = [
  { type: 'aim', label: 'Aim' },
  { type: 'trigger', label: 'Trigger' },
  { type: 'strafe_wtap', label: 'Strafe / W-Tap' },
  { type: 'connection', label: 'Connection' },
  { type: 'scaffold', label: 'Scaffold' },
  { type: 'automation', label: 'Automation' },
  { type: 'xray_esp', label: 'X-Ray / ESP' },
  { type: 'movement', label: 'Movement' },
  { type: 'other', label: 'Other' },
];

interface CheatTypeStepProps {
  selected: CheatType[];
  onToggle: (type: CheatType) => void;
  onNext: () => void;
}

export const CheatTypeStep: React.FC<CheatTypeStepProps> = ({ selected, onToggle, onNext }) => (
  <div>
    <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>
      Select Cheat Types
    </h3>
    <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 16 }}>
      Select all that apply
    </p>
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: 8,
      marginBottom: 20,
    }}>
      {CHEAT_OPTIONS.map(({ type, label }) => {
        const isSelected = selected.includes(type);
        return (
          <button
            key={type}
            onClick={() => onToggle(type)}
            style={{
              padding: '10px 12px',
              background: isSelected ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${isSelected ? 'rgba(99, 102, 241, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
              borderRadius: 8,
              color: 'white',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
    <button
      onClick={onNext}
      disabled={selected.length === 0}
      style={{
        width: '100%',
        padding: '10px 16px',
        background: selected.length > 0 ? 'rgba(99, 102, 241, 0.6)' : 'rgba(255,255,255,0.1)',
        border: '1px solid rgba(99, 102, 241, 0.4)',
        borderRadius: 8,
        color: selected.length > 0 ? 'white' : 'rgba(255,255,255,0.3)',
        fontSize: 14,
        fontWeight: 500,
        cursor: selected.length > 0 ? 'pointer' : 'default',
      }}
    >
      Next
    </button>
  </div>
);
