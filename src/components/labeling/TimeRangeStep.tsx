import React, { useRef, useState, useCallback } from 'react';
import type { CheatType, TimeRange } from '../../types/labeling';

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

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

interface TimeRangeStepProps {
  cheatType: CheatType;
  ranges: TimeRange[];
  currentTimeMs: number;
  totalDurationMs: number;
  onAddRange: () => void;
  onSetStart: (index: number, timeMs?: number) => void;
  onSetEnd: (index: number, timeMs?: number) => void;
  onRemoveRange: (index: number) => void;
  onNext: () => void;
}

interface DragState {
  rangeIndex: number;
  mode: 'move' | 'resize-start' | 'resize-end';
  startX: number;
  origStartMs: number;
  origEndMs: number;
}

export const TimeRangeStep: React.FC<TimeRangeStepProps> = ({
  cheatType,
  ranges,
  currentTimeMs,
  totalDurationMs,
  onAddRange,
  onSetStart,
  onSetEnd,
  onRemoveRange,
  onNext,
}) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const pxToTime = useCallback((clientX: number): number => {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    const ratio = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(totalDurationMs, ratio * totalDurationMs));
  }, [totalDurationMs]);

  const handlePointerDown = useCallback((e: React.PointerEvent, rangeIndex: number, mode: DragState['mode']) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const range = ranges[rangeIndex];
    setDrag({
      rangeIndex,
      mode,
      startX: e.clientX,
      origStartMs: range.startMs,
      origEndMs: range.endMs,
    });
  }, [ranges]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag) return;
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;

    const deltaPx = e.clientX - drag.startX;
    const deltaMs = (deltaPx / rect.width) * totalDurationMs;

    if (drag.mode === 'move') {
      const duration = drag.origEndMs - drag.origStartMs;
      let newStart = drag.origStartMs + deltaMs;
      let newEnd = drag.origEndMs + deltaMs;
      // Clamp to bounds
      if (newStart < 0) { newStart = 0; newEnd = duration; }
      if (newEnd > totalDurationMs) { newEnd = totalDurationMs; newStart = totalDurationMs - duration; }
      onSetStart(drag.rangeIndex, Math.round(newStart));
      onSetEnd(drag.rangeIndex, Math.round(newEnd));
    } else if (drag.mode === 'resize-start') {
      const newStart = Math.max(0, Math.min(drag.origEndMs, drag.origStartMs + deltaMs));
      onSetStart(drag.rangeIndex, Math.round(newStart));
    } else if (drag.mode === 'resize-end') {
      const newEnd = Math.max(drag.origStartMs, Math.min(totalDurationMs, drag.origEndMs + deltaMs));
      onSetEnd(drag.rangeIndex, Math.round(newEnd));
    }
  }, [drag, totalDurationMs, onSetStart, onSetEnd]);

  const handlePointerUp = useCallback(() => {
    setDrag(null);
  }, []);

  const HANDLE_WIDTH = 6;

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>
        Time Ranges — {CHEAT_LABELS[cheatType]}
      </h3>
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginBottom: 4 }}>
        Mark when this cheat is visible. Seek the replay, then click Set Start / Set End — or drag ranges on the timeline.
      </p>
      <p style={{ color: 'rgba(99, 102, 241, 0.8)', fontSize: 12, marginBottom: 16 }}>
        Current time: {formatTime(currentTimeMs)}
      </p>

      {/* Mini timeline */}
      <div
        ref={timelineRef}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          height: 24,
          background: 'rgba(255,255,255,0.05)',
          borderRadius: 4,
          position: 'relative',
          marginBottom: 16,
          touchAction: 'none',
        }}
      >
        {ranges.map((r, i) => {
          const left = totalDurationMs > 0 ? (r.startMs / totalDurationMs) * 100 : 0;
          const width = totalDurationMs > 0 ? ((r.endMs - r.startMs) / totalDurationMs) * 100 : 0;
          const isDragging = drag?.rangeIndex === i;
          return (
            <React.Fragment key={i}>
              {/* Range body — drag to move */}
              <div
                onPointerDown={(e) => handlePointerDown(e, i, 'move')}
                style={{
                  position: 'absolute',
                  left: `${left}%`,
                  width: `${Math.max(width, 0.5)}%`,
                  top: 0,
                  bottom: 0,
                  background: isDragging && drag?.mode === 'move'
                    ? 'rgba(239, 68, 68, 0.6)'
                    : 'rgba(239, 68, 68, 0.4)',
                  borderRadius: 2,
                  cursor: isDragging && drag?.mode === 'move' ? 'grabbing' : 'grab',
                  zIndex: 1,
                }}
              />
              {/* Left resize handle */}
              <div
                onPointerDown={(e) => handlePointerDown(e, i, 'resize-start')}
                style={{
                  position: 'absolute',
                  left: `${left}%`,
                  width: HANDLE_WIDTH,
                  marginLeft: -HANDLE_WIDTH / 2,
                  top: 0,
                  bottom: 0,
                  cursor: 'ew-resize',
                  zIndex: 2,
                  background: isDragging && drag?.mode === 'resize-start'
                    ? 'rgba(34, 197, 94, 0.8)'
                    : 'rgba(34, 197, 94, 0.5)',
                  borderRadius: 2,
                }}
              />
              {/* Right resize handle */}
              <div
                onPointerDown={(e) => handlePointerDown(e, i, 'resize-end')}
                style={{
                  position: 'absolute',
                  left: `calc(${left + width}% - ${HANDLE_WIDTH / 2}px)`,
                  width: HANDLE_WIDTH,
                  top: 0,
                  bottom: 0,
                  cursor: 'ew-resize',
                  zIndex: 2,
                  background: isDragging && drag?.mode === 'resize-end'
                    ? 'rgba(239, 68, 68, 0.8)'
                    : 'rgba(239, 68, 68, 0.6)',
                  borderRadius: 2,
                }}
              />
            </React.Fragment>
          );
        })}
        {/* Current time indicator */}
        <div style={{
          position: 'absolute',
          left: `${totalDurationMs > 0 ? (currentTimeMs / totalDurationMs) * 100 : 0}%`,
          top: 0,
          bottom: 0,
          width: 2,
          background: 'white',
          zIndex: 3,
          pointerEvents: 'none',
        }} />
      </div>

      {/* Range list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
        {ranges.map((range, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,0.05)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>#{i + 1}</span>
              <button
                onClick={() => onRemoveRange(i)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'rgba(255,255,255,0.3)',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                &times;
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => onSetStart(i)}
                style={{
                  padding: '3px 6px',
                  background: 'rgba(34, 197, 94, 0.2)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  borderRadius: 4,
                  color: '#22c55e',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                Start
              </button>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {formatTime(range.startMs)}
              </span>
              <span style={{ color: 'rgba(255,255,255,0.3)' }}>—</span>
              <button
                onClick={() => onSetEnd(i)}
                style={{
                  padding: '3px 6px',
                  background: 'rgba(239, 68, 68, 0.2)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 4,
                  color: '#ef4444',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                End
              </button>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {formatTime(range.endMs)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onAddRange}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.7)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          + Add Range
        </button>
        <button
          onClick={onNext}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: 'rgba(99, 102, 241, 0.6)',
            border: '1px solid rgba(99, 102, 241, 0.4)',
            borderRadius: 8,
            color: 'white',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Next
        </button>
      </div>
    </div>
  );
};
