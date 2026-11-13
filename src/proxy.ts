import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Optimistic check only (cookie present). Real authorization happens in requireOrg/requireAdmin.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request)) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = {
  // Everything except login, auth API, provider webhooks, the public web-chat widget (script, API, demo page)
  // and static assets.
  matcher: ["/((?!login|api/auth|api/webhooks|api/widget/|widget\\.js|widget-demo\\.html|_next|favicon.ico).*)"],
};
