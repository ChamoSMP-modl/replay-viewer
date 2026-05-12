import React from 'react';

interface ConfidenceStepProps {
  confidence: number;
  notes: string;
  onConfidenceChange: (value: number) => void;
  onNotesChange: (value: string) => void;
  onNext: () => void;
}

export const ConfidenceStep: React.FC<ConfidenceStepProps> = ({
  confidence,
  notes,
  onConfidenceChange,
  onNotesChange,
  onNext,
}) => (
  <div>
    <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>
      Confidence & Notes
    </h3>

    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 8 }}>
        Confidence: {confidence}%
      </label>
      <input
        type="range"
        min={0}
        max={100}
        value={confidence}
        onChange={(e) => onConfidenceChange(Number(e.target.value))}
        style={{ width: '100%', cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>
        <span>Unsure</span>
        <span>Certain</span>
      </div>
    </div>

    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 8 }}>
        Notes (optional — e.g., hacked client name)
      </label>
      <textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="Any additional observations..."
        style={{
          width: '100%',
          minHeight: 80,
          padding: '8px 12px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          color: 'white',
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
          resize: 'vertical',
        }}
      />
    </div>

    <button
      onClick={onNext}
      style={{
        width: '100%',
        padding: '10px 16px',
        background: 'rgba(99, 102, 241, 0.6)',
        border: '1px solid rgba(99, 102, 241, 0.4)',
        borderRadius: 8,
        color: 'white',
        fontSize: 14,
        fontWeight: 500,
        cursor: 'pointer',
      }}
    >
      Next Player
    </button>
  </div>
);
