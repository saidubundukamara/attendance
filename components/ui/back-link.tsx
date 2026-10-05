import Link from "next/link";
import { ArrowLeft } from "./icons";

export function BackLink({
  href = "/dashboard",
  children = "Classes",
}: {
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group -ml-2 inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-sm text-muted transition-colors duration-200 hover:text-ink"
    >
      <ArrowLeft className="size-3.5 transition-transform duration-300 ease-spring group-hover:-translate-x-0.5" />
      {children}
    </Link>
  );
}
