// Shared TypeScript types mirroring the Arena Texas Hold'em API.
// Source: /Users/maxim/Documents/GitHub/poker-arena/src/agent/state.py

export type Street = "PreDeal" | "Preflop" | "Flop" | "Turn" | "River" | "Showdown";
export type SeatStatus = "Pending" | "Active" | "Folded" | "AllIn" | "Settled";
export type TableStatus = "Waiting" | "Forming" | "Active" | "Completed" | "Cancelled";
export type ActionType = "fold" | "check" | "call" | "bet" | "raise" | "all-in";

export interface Seat {
  seatId: string;
  seatNumber: number | null;
  agentId: string;
  agentName: string;
  agentHandle: string;
  status: SeatStatus;
  stackChips: number;
  currentBetChips: number;
  totalCommittedChips: number;
  payoutChips?: number | null;
  holeCards?: string[] | null;
}

export interface AllowedActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  canBet: boolean;
  canRaise: boolean;
  canAllIn: boolean;
  callAmount: number;
  callChips: number;
  callToAmount?: number | null;
  minBet?: number | null;
  minRaiseTo?: number | null;
  maxCommit: number;
  allInToAmount?: number | null;
  availableActions: ActionType[];
  amountHint: string;
  actionHint: string;
}

export interface TableEventSummary {
  action?: string | null;
  amount?: number | null;
  toAmount?: number | null;
  reasoning?: string | null;
  cards?: string[] | null;
  boardCards?: string[] | null;
  seatNumber?: number | null;
  agentName?: string | null;
}

export interface TableEvent {
  id: string;
  sequence: number;
  type: string;
  street?: Street | null;
  occurredAt: number;
  summary?: TableEventSummary | null;
}

export interface Table {
  tableId: string;
  tableNumber: number;
  competitionId: string;
  status: TableStatus;
  street: Street;
  potChips: number;
  currentBet: number;
  minRaiseTo?: number | null;
  startedAt?: number | null;
  actionDeadlineAt?: number | null;
  boardCards: string[];
  smallBlindChips: number;
  bigBlindChips: number;
  buyInChips: number;
  seats: Seat[];
  actingSeatNumber?: number | null;
  selfSeatNumber?: number | null;
  allowedActions?: AllowedActions | null;
  recentEvents: TableEvent[];
}

export interface PlayingStyle {
  tightness?: "tight" | "balanced" | "loose" | null;
  aggression?: "passive" | "measured" | "aggressive" | null;
  archetype?: string | null;
  tagline?: string | null;
}

export interface AgentStats {
  agentId: string;
  agentName?: string;
  agentHandle?: string;
  handsObserved?: number;
  vpip?: number | null;
  pfr?: number | null;
  threeBetPct?: number | null;
  af?: number | null;
  bluffPct?: number | null;
  wtsd?: number | null;
  wsd?: number | null;
  playingStyle?: PlayingStyle | null;
  [k: string]: unknown;
}

export interface AgentMe {
  agentId: string;
  handle?: string;
  name?: string;
  quote?: string;
  description?: string;
  [k: string]: unknown;
}

export interface ClaimStatus {
  claimed: boolean;
  agentId?: string;
  agentHandle?: string;
  agentName?: string;
  competitionId?: string;
}

export interface ActionRequest {
  tableId: string;
  action: ActionType;
  amount?: number | null;
  message: string;
  reasoning?: string;
}
