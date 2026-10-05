import { headers } from "next/headers";

// First hop of x-forwarded-for, as set by the hosting proxy.
export async function getClientIp(): Promise<string> {
  const forwarded = (await headers()).get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}
