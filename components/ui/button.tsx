import { ArrowRight } from "./icons";

type Variant =
  | "primary"
  | "accent"
  | "secondary"
  | "danger"
  | "destructive"
  | "ghost";
type Size = "sm" | "md" | "lg";

const base =
  "group inline-flex items-center gap-2 rounded-full font-medium whitespace-nowrap " +
  "transition-[transform,background-color,border-color,color,opacity] duration-300 ease-spring " +
  "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink/85",
  accent: "bg-accent text-white hover:bg-accent-strong",
  secondary:
    "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:bg-sunken",
  danger:
    "bg-surface text-danger ring-1 ring-inset ring-danger/30 hover:bg-danger-soft",
  destructive: "bg-danger text-white hover:bg-danger/85",
  ghost: "text-muted hover:bg-ink/5 hover:text-ink",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3.5 text-sm",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

// With a trailing arrow the right padding tightens so the badge sits flush.
const arrowPadding: Record<Size, string> = {
  sm: "pr-1",
  md: "pr-1.5",
  lg: "pr-1.5",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  arrow = false,
  block = false,
  className = "",
}: {
  variant?: Variant;
  size?: Size;
  arrow?: boolean;
  // Full width, label left and arrow right.
  block?: boolean;
  className?: string;
} = {}): string {
  return [
    base,
    variants[variant],
    sizes[size],
    arrow ? arrowPadding[size] : "",
    block ? "w-full justify-between" : "justify-center",
    className,
  ].join(" ");
}

// The arrow rides in its own circle and leans forward on hover.
export function ArrowBadge({ size = "md" }: { size?: Size }) {
  return (
    <span
      className={`flex items-center justify-center rounded-full bg-white/15 transition-transform duration-300 ease-spring group-hover:translate-x-0.5 ${
        size === "lg" ? "size-9" : size === "md" ? "size-7" : "size-6"
      }`}
    >
      <ArrowRight className="size-3.5" />
    </span>
  );
}

export function Button({
  variant,
  size,
  arrow,
  block,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  arrow?: boolean;
  block?: boolean;
}) {
  return (
    <button
      type="button"
      {...props}
      className={buttonClass({ variant, size, arrow, block, className })}
    >
      {children}
      {arrow && <ArrowBadge size={size} />}
    </button>
  );
}
