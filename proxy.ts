import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

// Early redirect for signed-out visitors. Only checks the cookie signature;
// pages, actions and route handlers still call requireLecturer().
export function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (verifySessionToken(token, process.env.AUTH_SECRET)) {
    return NextResponse.next();
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/classes/:path*",
    "/sessions/:path*",
    "/students/:path*",
    "/api/sessions/:path*",
  ],
};
