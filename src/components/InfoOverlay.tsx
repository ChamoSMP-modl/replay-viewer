import React from 'react';

interface InfoOverlayProps {
  replayId?: string;
  duration: number;
  playerCount: number;
  playerNames: string[];
  onClose: () => void;
  onLabelReplay: () => void;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const InfoOverlay: React.FC<InfoOverlayProps> = ({
  replayId,
  duration,
  playerCount,
  playerNames,
  onClose,
  onLabelReplay,
}) => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(4px)',
      WebkitBackdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 20,
    }}
    onClick={onClose}
  >
    <div
      style={{
        background: 'rgba(15, 15, 30, 0.8)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 16,
        padding: '28px 32px',
        minWidth: 320,
        maxWidth: 400,
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
        position: 'relative',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 12,
          right: 16,
          background: 'none',
          border: 'none',
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: 22,
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        &times;
      </button>

      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Replay Info</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 14 }}>
        <div>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Replay ID
          </span>
          <div style={{ marginTop: 2, fontFamily: 'monospace', fontSize: 13 }}>
            {replayId || 'Local File'}
          </div>
        </div>

        <div>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Duration
          </span>
          <div style={{ marginTop: 2 }}>{formatTime(duration)}</div>
        </div>

        <div>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Players ({playerCount})
          </span>
          <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {playerNames.map((name) => (
              <span
                key={name}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 12,
                }}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={onLabelReplay}
        style={{
          marginTop: 24,
          width: '100%',
          padding: '10px 16px',
          background: 'rgba(99, 102, 241, 0.6)',
          border: '1px solid rgba(99, 102, 241, 0.4)',
          borderRadius: 8,
          color: 'white',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'background 0.2s',
        }}
      >
        Label This Replay
      </button>
    </div>
  </div>
);
