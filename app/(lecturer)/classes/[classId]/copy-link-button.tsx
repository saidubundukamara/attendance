"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Check } from "@/components/ui/icons";

type State = "idle" | "copied" | "failed";

// Copies `url` for pasting into a group chat or email.
export function CopyLinkButton({ url }: { url: string }) {
  const [state, setState] = useState<State>("idle");
  const fallback = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      return;
    } catch {
      // The clipboard API needs HTTPS or localhost; a plain-HTTP LAN
      // address lands here.
    }
    const input = fallback.current;
    if (input) {
      input.select();
      setState(document.execCommand("copy") ? "copied" : "failed");
    } else {
      setState("failed");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input
        ref={fallback}
        readOnly
        value={url}
        aria-hidden
        tabIndex={-1}
        className="sr-only"
      />
      <Button variant="secondary" size="sm" onClick={() => void copy()}>
        {state === "copied" && <Check className="size-3.5" />}
        {state === "copied" ? "Copied" : "Copy link"}
      </Button>
      {state === "failed" && (
        <span role="status" className="text-sm text-danger">
          Copy failed — select the link
        </span>
      )}
    </span>
  );
}
