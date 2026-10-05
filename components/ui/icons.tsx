// One stroke weight and one grid for every icon in the app.
type IconProps = { className?: string };

function Icon({
  className = "size-4",
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </Icon>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 8H3M7 4 3 8l4 4" />
    </Icon>
  );
}

export function Check(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m3.5 8.5 3 3 6-7" />
    </Icon>
  );
}

export function Cross(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </Icon>
  );
}

export function Plus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 3v10M3 8h10" />
    </Icon>
  );
}

export function Refresh(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v2.8h-2.8" />
    </Icon>
  );
}

export function Warning(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 2.5 14 13H2L8 2.5ZM8 6.5v3M8 11.2v.1" />
    </Icon>
  );
}

export function Dot(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8 8v.01" strokeWidth="2.4" />
    </Icon>
  );
}
