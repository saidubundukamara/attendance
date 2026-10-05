import { Check, Warning } from "./icons";

type Tone = "warn" | "ok" | "danger";

const tones: Record<Tone, string> = {
  warn: "bg-warn-soft text-warn",
  ok: "bg-accent-soft text-accent-strong",
  danger: "bg-danger-soft text-danger",
};

export function Notice({
  tone = "warn",
  role = "status",
  action,
  className = "",
  children,
}: {
  tone?: Tone;
  role?: "status" | "alert";
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={role}
      className={`flex w-full animate-rise flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl px-4 py-3 text-left text-sm ${tones[tone]} ${className}`}
    >
      {tone === "ok" ? (
        <Check className="size-4" />
      ) : (
        <Warning className="size-4" />
      )}
      <div className="min-w-0 flex-1 basis-56">{children}</div>
      {action}
    </div>
  );
}
