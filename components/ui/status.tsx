import { Check, Cross, Dot } from "./icons";

export type Mark = "PRESENT" | "ABSENT" | null | undefined;

export function markLabel(mark: Mark): string {
  return mark === "PRESENT" ? "Present" : mark === "ABSENT" ? "Absent" : "No record";
}

const cell: Record<"PRESENT" | "ABSENT" | "NONE", string> = {
  PRESENT: "bg-accent-soft text-accent-strong",
  ABSENT: "bg-danger-soft text-danger",
  NONE: "bg-sunken text-faint",
};

export function markClass(mark: Mark): string {
  return cell[mark ?? "NONE"];
}

export function MarkIcon({ mark }: { mark: Mark }) {
  if (mark === "PRESENT") return <Check className="size-3.5" />;
  if (mark === "ABSENT") return <Cross className="size-3.5" />;
  return <Dot className="size-3.5" />;
}

// A live session: solid dot with a ring that keeps breathing outward.
export function LiveDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inset-0 animate-pulse-dot rounded-full bg-accent" />
      <span className="relative size-2 rounded-full bg-accent" />
    </span>
  );
}
