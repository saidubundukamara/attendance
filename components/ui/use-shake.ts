"use client";

import { useEffect, useRef } from "react";

// Shakes the element each time `trigger` changes to something truthy, so a
// repeated identical error still gets a response.
export function useShake<T extends HTMLElement>(trigger: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!trigger || !ref.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    ref.current.animate(
      [0, -6, 5, -3, 2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 450, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
    );
  }, [trigger]);
  return ref;
}
