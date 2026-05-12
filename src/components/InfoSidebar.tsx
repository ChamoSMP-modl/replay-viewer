import React, { useState } from 'react';
import { LabelingWizard } from './LabelingWizard';
import type { PlayerLabel } from '../types/labeling';

interface InfoSidebarProps {
  replayId?: string;
  duration: number;
  playerCount: number;
  playerNames: string[];
  onClose: () => void;
  players: Array<{ uuid: string; playerName: string }>;
  currentTimeMs: number;
  totalDurationMs: number;
  onLabelSubmit?: (labels: PlayerLabel[]) => void | Promise<void>;
  labelApiUrl?: string;
  labeled?: boolean;
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const InfoSidebar: React.FC<InfoSidebarProps> = ({
  replayId,
  duration,
  playerCount,
  playerNames,
  onClose,
  players,
  currentTimeMs,
  totalDurationMs,
  onLabelSubmit,
  labelApiUrl,
  labeled,
}) => {
  const [showLabeling, setShowLabeling] = useState(false);

  return (
    <div style={{
      position: 'absolute',
      top: 16,
      left: 16,
      bottom: 80,
      width: 300,
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
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Close button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 8,
          right: 12,
          background: 'none',
          border: 'none',
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: 18,
          cursor: 'pointer',
          lineHeight: 1,
          zIndex: 1,
        }}
      >
        &times;
      </button>

      {!showLabeling ? (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Replay Info */}
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.5, marginBottom: 8 }}>
              Replay Info
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Replay ID
                </span>
                <div style={{ marginTop: 2, fontFamily: 'monospace', fontSize: 12 }}>
                  {replayId || 'Local File'}
                </div>
              </div>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Duration
                </span>
                <div style={{ marginTop: 2 }}>{formatTime(duration)}</div>
              </div>
              <div>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Players ({playerCount})
                </span>
                <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {playerNames.map((name) => (
                    <span
                      key={name}
                      style={{
                        background: 'rgba(255,255,255,0.08)',
                        borderRadius: 4,
                        padding: '2px 6px',
                        fontSize: 11,
                      }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} />

          {/* Keybind Hints */}
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.5, marginBottom: 8 }}>
              Keyboard Shortcuts
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { key: 'Space', action: 'Play / Pause' },
                { key: '\u2190', action: 'Rewind 5s' },
                { key: '\u2192', action: 'Forward 5s' },
              ].map(({ key, action }) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    background: 'rgba(255,255,255,0.1)',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    minWidth: 44,
                    textAlign: 'center',
                  }}>
                    {key}
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.7 }}>{action}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} />

          {/* Label Button */}
          {labeled ? (
            <div
              style={{
                width: '100%',
                padding: '8px 14px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                color: 'rgba(255,255,255,0.4)',
                fontSize: 13,
                fontWeight: 500,
                textAlign: 'center',
              }}
            >
              Already Labeled
            </div>
          ) : (
            <button
              onClick={() => setShowLabeling(true)}
              style={{
                width: '100%',
                padding: '8px 14px',
                background: 'rgba(99, 102, 241, 0.6)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: 8,
                color: 'white',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              Label This Replay
            </button>
          )}
        </div>
      ) : (
        <LabelingWizard
          players={players}
          currentTimeMs={currentTimeMs}
          totalDurationMs={totalDurationMs}
          onClose={() => setShowLabeling(false)}
          onSubmit={onLabelSubmit}
          labelApiUrl={labelApiUrl}
          replayId={replayId}
        />
      )}
    </div>
  );
};
