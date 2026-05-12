export type CheatType =
  | 'aim'
  | 'trigger'
  | 'strafe_wtap'
  | 'connection'
  | 'scaffold'
  | 'automation'
  | 'xray_esp'
  | 'movement'
  | 'other';

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export interface CheatDetail {
  type: CheatType;
  timeRanges: TimeRange[];
}

export interface PlayerLabel {
  uuid: string;
  playerName: string;
  verdict: 'legit' | 'cheating' | 'unsure';
  confidence: number;
  cheats: CheatDetail[];
  notes: string;
}
