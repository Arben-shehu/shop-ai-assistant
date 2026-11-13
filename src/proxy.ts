import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Optimistic check only (cookie present). Real authorization happens in requireOrg/requireAdmin.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  // Everything except login, auth API, provider webhooks and static assets.
  matcher: ["/((?!login|api/auth|api/webhooks|_next/static|_next/image|favicon.ico).*)"],
};
