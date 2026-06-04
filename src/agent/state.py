"""Typed models mirroring the dev.fun Arena Texas Holdem API.

Field names follow the live introspection schema at
https://arena.dev.fun/api/arena/__introspection. A frozen snapshot is at
data/introspection.json — refresh it when fields change.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Model(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class Street(str, Enum):
    PRE_DEAL = "PreDeal"
    PREFLOP = "Preflop"
    FLOP = "Flop"
    TURN = "Turn"
    RIVER = "River"
    SHOWDOWN = "Showdown"


class SeatStatus(str, Enum):
    PENDING = "Pending"
    ACTIVE = "Active"
    FOLDED = "Folded"
    ALL_IN = "AllIn"
    SETTLED = "Settled"


class TableStatus(str, Enum):
    WAITING = "Waiting"
    FORMING = "Forming"
    ACTIVE = "Active"
    COMPLETED = "Completed"
    CANCELLED = "Cancelled"


ActionType = Literal["fold", "check", "call", "bet", "raise", "all-in"]


class Seat(_Model):
    seat_id: str = Field(alias="seatId")
    seat_number: int | None = Field(alias="seatNumber")
    agent_id: str = Field(alias="agentId")
    agent_name: str = Field(alias="agentName")
    agent_handle: str = Field(alias="agentHandle")
    status: SeatStatus
    stack_chips: int = Field(alias="stackChips")
    current_bet_chips: int = Field(alias="currentBetChips")
    total_committed_chips: int = Field(alias="totalCommittedChips")
    payout_chips: int | None = Field(default=None, alias="payoutChips")
    hole_cards: list[str] | None = Field(default=None, alias="holeCards")


class AllowedActions(_Model):
    can_fold: bool = Field(alias="canFold")
    can_check: bool = Field(alias="canCheck")
    can_call: bool = Field(alias="canCall")
    can_bet: bool = Field(alias="canBet")
    can_raise: bool = Field(alias="canRaise")
    can_all_in: bool = Field(alias="canAllIn")
    call_amount: int = Field(alias="callAmount")
    call_chips: int = Field(alias="callChips")
    call_to_amount: int | None = Field(default=None, alias="callToAmount")
    min_bet: int | None = Field(default=None, alias="minBet")
    min_raise_to: int | None = Field(default=None, alias="minRaiseTo")
    max_commit: int = Field(alias="maxCommit")
    all_in_to_amount: int | None = Field(default=None, alias="allInToAmount")
    available_actions: list[ActionType] = Field(alias="availableActions")
    amount_hint: str = Field(alias="amountHint")
    action_hint: str = Field(alias="actionHint")


class EventSummary(_Model):
    action: str | None = None
    amount: int | None = None
    to_amount: int | None = Field(default=None, alias="toAmount")
    reasoning: str | None = None
    cards: list[str] | None = None
    board_cards: list[str] | None = Field(default=None, alias="boardCards")
    seat_number: int | None = Field(default=None, alias="seatNumber")
    agent_name: str | None = Field(default=None, alias="agentName")


class TableEvent(_Model):
    id: str
    sequence: int
    type: str
    street: Street | None = None
    occurred_at: float = Field(alias="occurredAt")
    summary: EventSummary | None = None


class Table(_Model):
    table_id: str = Field(alias="tableId")
    table_number: int = Field(alias="tableNumber")
    competition_id: str = Field(alias="competitionId")
    status: TableStatus
    street: Street
    pot_chips: int = Field(alias="potChips")
    current_bet: int = Field(alias="currentBet")
    min_raise_to: int | None = Field(default=None, alias="minRaiseTo")
    started_at: float | None = Field(default=None, alias="startedAt")
    action_deadline_at: float | None = Field(default=None, alias="actionDeadlineAt")
    board_cards: list[str] = Field(default_factory=list, alias="boardCards")
    small_blind_chips: int = Field(alias="smallBlindChips")
    big_blind_chips: int = Field(alias="bigBlindChips")
    buy_in_chips: int = Field(alias="buyInChips")
    seats: list[Seat] = Field(default_factory=list)
    acting_seat_number: int | None = Field(default=None, alias="actingSeatNumber")
    self_seat_number: int | None = Field(default=None, alias="selfSeatNumber")
    allowed_actions: AllowedActions | None = Field(default=None, alias="allowedActions")
    recent_events: list[TableEvent] = Field(default_factory=list, alias="recentEvents")

    @property
    def hero_seat(self) -> Seat | None:
        if self.self_seat_number is None:
            return None
        return next((s for s in self.seats if s.seat_number == self.self_seat_number), None)

    @property
    def hero_hole_cards(self) -> list[str] | None:
        s = self.hero_seat
        return s.hole_cards if s else None

    @property
    def active_opponents(self) -> list[Seat]:
        return [
            s for s in self.seats
            if s.seat_number != self.self_seat_number
            and s.status in (SeatStatus.ACTIVE, SeatStatus.ALL_IN)
        ]


class Decision(BaseModel):
    """The agent's response. `amount` is a TO-amount (total street commitment)."""
    action: ActionType
    amount: int | None = None
    message: str = "gg"
    reasoning: str | None = None
    layer: Literal["L1", "L2", "L3", "safe"] = "safe"
    latency_ms: float = 0.0


class PendingActionsResponse(_Model):
    tables: list[Table] = Field(default_factory=list)
