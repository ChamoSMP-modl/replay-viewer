import React from 'react';

interface PlayerVerdictStepProps {
  playerName: string;
  onVerdict: (verdict: 'legit' | 'cheating' | 'unsure') => void;
}

export const PlayerVerdictStep: React.FC<PlayerVerdictStepProps> = ({ playerName, onVerdict }) => (
  <div style={{ textAlign: 'center' }}>
    <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
      {playerName}
    </h3>
    <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 24 }}>
      What is your verdict for this player?
    </p>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        onClick={() => onVerdict('legit')}
        style={{
          padding: '12px 16px',
          background: 'rgba(34, 197, 94, 0.2)',
          border: '1px solid rgba(34, 197, 94, 0.4)',
          borderRadius: 8,
          color: '#22c55e',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 0.2s',
          width: '100%',
        }}
      >
        Legit
      </button>
      <button
        onClick={() => onVerdict('cheating')}
        style={{
          padding: '12px 16px',
          background: 'rgba(239, 68, 68, 0.2)',
          border: '1px solid rgba(239, 68, 68, 0.4)',
          borderRadius: 8,
          color: '#ef4444',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 0.2s',
          width: '100%',
        }}
      >
        Cheating
      </button>
      <button
        onClick={() => onVerdict('unsure')}
        style={{
          padding: '12px 16px',
          background: 'rgba(234, 179, 8, 0.2)',
          border: '1px solid rgba(234, 179, 8, 0.4)',
          borderRadius: 8,
          color: '#eab308',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 0.2s',
          width: '100%',
        }}
      >
        Unsure
      </button>
    </div>
  </div>
);
