import React, { useState } from 'react';
import type { PlayerLabel, CheatType } from '../../types/labeling';

const CHEAT_LABELS: Record<CheatType, string> = {
  aim: 'Aim',
  trigger: 'Trigger',
  strafe_wtap: 'Strafe / W-Tap',
  connection: 'Connection',
  scaffold: 'Scaffold',
  automation: 'Automation',
  xray_esp: 'X-Ray / ESP',
  movement: 'Movement',
  other: 'Other',
};

function toSimpleLabel(label: PlayerLabel): string {
  if (label.verdict === 'legit') return 'legit';
  if (label.verdict === 'unsure') return 'unsure';
  const types = label.cheats.map((c) => c.type);
  if (types.includes('aim') || types.includes('trigger')) return 'aimbot';
  if (types.includes('scaffold')) return 'scaffold';
  return 'cheating';
}

function verdictColor(verdict: string): string {
  if (verdict === 'legit') return '#22c55e';
  if (verdict === 'unsure') return '#eab308';
  return '#ef4444';
}

interface ReviewStepProps {
  labels: PlayerLabel[];
  onSubmit?: (labels: PlayerLabel[]) => void | Promise<void>;
  onClose: () => void;
  labelApiUrl?: string;
  replayId?: string;
}

export const ReviewStep: React.FC<ReviewStepProps> = ({ labels, onSubmit, onClose, labelApiUrl, replayId }) => {
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const canSubmit = !!(onSubmit || (labelApiUrl && replayId));

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      // If onSubmit callback is provided, use it (handles auth/headers in the host app)
      if (onSubmit) {
        await onSubmit(labels);
      }

      // If labelApiUrl is provided, also POST directly
      if (labelApiUrl && replayId) {
        const url = `${labelApiUrl.replace(/\/+$/, '')}/v1/public/replays/${encodeURIComponent(replayId)}/label`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ players: labels }),
        });
        if (resp.status === 409) {
          throw new Error('This replay has already been labeled');
        }
        if (!resp.ok) {
          throw new Error(`Server returned ${resp.status}`);
        }
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>
        Review Labels
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20, maxHeight: 260, overflowY: 'auto' }}>
        {labels.map((label) => (
          <div
            key={label.uuid}
            style={{
              background: 'rgba(255,255,255,0.05)',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: 13,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontWeight: 500 }}>{label.playerName}</span>
              <span style={{
                color: verdictColor(label.verdict),
                fontWeight: 600,
                fontSize: 12,
                textTransform: 'uppercase',
              }}>
                {label.verdict}
              </span>
            </div>
            {label.verdict === 'cheating' && label.cheats.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                {label.cheats.map((c) => (
                  <span
                    key={c.type}
                    style={{
                      fontSize: 10,
                      padding: '1px 6px',
                      background: 'rgba(239, 68, 68, 0.2)',
                      borderRadius: 3,
                      color: '#fca5a5',
                    }}
                  >
                    {CHEAT_LABELS[c.type]}
                  </span>
                ))}
              </div>
            )}
            <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
              Confidence: {label.confidence}%
              {label.notes && ` — ${label.notes}`}
            </div>
          </div>
        ))}
      </div>

      {/* Submit button */}
      {canSubmit && !submitted && (
        <button
          onClick={handleSubmit}
          disabled={submitting}
          style={{
            width: '100%',
            padding: '10px 16px',
            background: submitting ? 'rgba(99, 102, 241, 0.3)' : 'rgba(99, 102, 241, 0.6)',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            borderRadius: 8,
            color: 'white',
            fontSize: 14,
            fontWeight: 500,
            cursor: submitting ? 'not-allowed' : 'pointer',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {submitting ? (
            <>
              <span style={{
                display: 'inline-block',
                width: 14,
                height: 14,
                border: '2px solid rgba(255,255,255,0.3)',
                borderTopColor: 'white',
                borderRadius: '50%',
                animation: 'modl-spin 0.6s linear infinite',
              }} />
              Submitting...
            </>
          ) : (
            'Submit Labels'
          )}
        </button>
      )}

      {/* Success message */}
      {submitted && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(34, 197, 94, 0.15)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          borderRadius: 8,
          color: '#22c55e',
          fontSize: 13,
          marginBottom: 8,
          textAlign: 'center',
        }}>
          Labels submitted successfully
        </div>
      )}

      {/* Error message */}
      {submitError && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 8,
          color: '#ef4444',
          fontSize: 12,
          marginBottom: 8,
        }}>
          {submitError}
        </div>
      )}

      <button
        onClick={onClose}
        style={{
          width: '100%',
          padding: '10px 16px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          color: 'rgba(255,255,255,0.7)',
          fontSize: 14,
          cursor: 'pointer',
        }}
      >
        Close
      </button>

      {/* Spinner animation */}
      <style>{`@keyframes modl-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
