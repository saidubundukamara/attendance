export const inputClass =
  "h-11 rounded-xl bg-surface px-3.5 text-base text-ink ring-1 ring-inset ring-line-strong " +
  "transition-shadow duration-200 ease-out-expo placeholder:text-faint " +
  "hover:ring-ink/30 focus:outline-none focus:ring-2 focus:ring-ink";

export function Label({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
      {children}
    </label>
  );
}
