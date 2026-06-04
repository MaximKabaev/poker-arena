// Renders a single playing card from a 2-char string like "As", "Td", "9h", "2c".
// Hidden cards (opponents' face-down hole cards) render as a card back.

const SUIT_GLYPH: Record<string, string> = { s: "\u2660", h: "\u2665", d: "\u2666", c: "\u2663" };
const RED = new Set(["h", "d"]);

interface Props {
  card?: string | null;
  size?: "sm" | "md" | "lg";
  hidden?: boolean;
}

const SIZE = {
  sm: "w-7 h-10 sm:w-8 sm:h-11 text-[10px] sm:text-xs",
  md: "w-10 h-14 sm:w-12 sm:h-16 text-sm sm:text-base",
  lg: "w-14 h-20 sm:w-16 sm:h-[5.5rem] text-base sm:text-lg",
};

export function Card({ card, size = "md", hidden }: Props) {
  if (hidden || !card) {
    return (
      <div
        className={`${SIZE[size]} rounded-md bg-gradient-to-br from-blue-900 to-blue-700 border border-blue-500/50 shadow-inner flex items-center justify-center`}
      >
        <div className="w-2/3 h-2/3 rounded-sm border border-blue-400/40 bg-blue-800/40" />
      </div>
    );
  }
  const rank = card.slice(0, -1).toUpperCase();
  const suit = card.slice(-1).toLowerCase();
  const isRed = RED.has(suit);
  return (
    <div
      className={`${SIZE[size]} rounded-md bg-white border border-zinc-300 shadow flex flex-col items-center justify-between p-1 text-center font-bold`}
    >
      <span className={isRed ? "text-red-600" : "text-zinc-900"}>{rank === "T" ? "10" : rank}</span>
      <span className={`${isRed ? "text-red-600" : "text-zinc-900"} text-xl leading-none`}>
        {SUIT_GLYPH[suit] ?? "?"}
      </span>
    </div>
  );
}
