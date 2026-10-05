"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./button";

// Two-step confirmation in place: the first press asks, the second acts.
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  pendingLabel,
  pending = false,
  variant = "danger",
  size = "md",
  type = "button",
  onConfirm,
}: {
  label: React.ReactNode;
  question: string;
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  variant?: "danger" | "secondary";
  size?: "sm" | "md";
  // "submit" lets the confirm press submit the surrounding form.
  type?: "button" | "submit";
  onConfirm?: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
  }, [asking]);

  if (!asking && !pending) {
    return (
      <Button variant={variant} size={size} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }

  return (
    <div
      role="group"
      aria-label={question}
      className="flex animate-pop flex-wrap items-center gap-2"
      onKeyDown={(event) => {
        if (event.key === "Escape") setAsking(false);
      }}
    >
      <span className="pr-1 text-sm font-medium">{question}</span>
      <Button
        ref={confirmRef}
        type={type}
        size={size}
        variant={variant === "danger" ? "destructive" : "primary"}
        disabled={pending}
        onClick={onConfirm}
      >
        {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
      </Button>
      <Button
        size={size}
        variant="ghost"
        disabled={pending}
        onClick={() => setAsking(false)}
      >
        Cancel
      </Button>
    </div>
  );
}
