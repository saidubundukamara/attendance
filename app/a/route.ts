// Student check-in. A route handler rather than a page so the response is
// one small HTML document with no framework JavaScript.
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { after } from "next/server";
import {
  checkIn,
  getCheckInSession,
  getDeviceCheckIn,
  isDeviceId,
} from "@/lib/checkin";
import { idErrorMessage, renderForm, renderResult } from "@/lib/checkin-page";
import { db } from "@/lib/db";
import { getClientIp } from "@/lib/request";
import { scheduleSheetSync } from "@/lib/sheets/sync";
import { signPass, verifyPass, verifyQrToken } from "@/lib/token";

const DEVICE_COOKIE = "device_id";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // The QR token is in the URL; do not leak it onward.
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const qr = verifyQrToken(token);
  if (!qr.ok) return html(renderResult("EXPIRED", null));

  const session = await getCheckInSession(db, qr.payload.sessionId);
  if (!session) return html(renderResult("EXPIRED", null));
  if (session.status !== "ACTIVE") return html(renderResult("CLOSED", session));

  const jar = await cookies();
  let deviceId = jar.get(DEVICE_COOKIE)?.value;
  if (!isDeviceId(deviceId)) {
    deviceId = randomUUID();
    jar.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: (process.env.APP_URL ?? "").startsWith("https://"),
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
    });
  }

  const already = await getDeviceCheckIn(db, session.id, deviceId);
  if (already) return html(renderResult("ALREADY", session, already.name));

  const pass = signPass({
    sessionId: session.id,
    nonce: qr.payload.nonce,
    deviceId,
  });
  return html(renderForm({ session, pass }));
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return html(renderResult("EXPIRED", null), 400);
  }
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : null;
  };
  const pass = field("pass");
  const studentIdRaw = field("studentId");

  const result = await checkIn(db, {
    pass,
    studentIdRaw,
    deviceId: (await cookies()).get(DEVICE_COOKIE)?.value ?? null,
    ip: await getClientIp(),
    userAgent: request.headers.get("user-agent") ?? "",
  });

  const session = result.sessionId
    ? ((await getCheckInSession(db, result.sessionId)) ?? null)
    : null;

  if (result.code === "NOT_FOUND" || result.code === "INVALID_ID") {
    // The pass was valid to get this far; keep the form up for another try.
    if (session && pass && verifyPass(pass).ok) {
      return html(
        renderForm({
          session,
          pass,
          error: idErrorMessage(result.code, studentIdRaw),
          value: (studentIdRaw ?? "").slice(0, 12),
        }),
      );
    }
    return html(renderResult("EXPIRED", session));
  }

  // The student gets their answer first; the sheet is updated afterwards.
  if (result.code === "OK") after(scheduleSheetSync);

  return html(renderResult(result.code, session, result.studentName));
}
