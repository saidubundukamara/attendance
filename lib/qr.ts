import QRCode from "qrcode";
import { QR_ROTATE_SECONDS, signQrToken } from "./token";

export type QrImage = {
  svg: string;
  // When the encoded token stops being accepted (Unix ms).
  expiresAt: number;
  // How long the display should show this code before fetching a new one.
  rotateInSeconds: number;
};

export function getAppUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function checkInUrl(token: string): string {
  return `${getAppUrl()}/a?t=${token}`;
}

export async function buildSessionQr(sessionId: string): Promise<QrImage> {
  const { token, payload } = signQrToken(sessionId);
  const svg = await QRCode.toString(checkInUrl(token), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
  });
  return {
    svg,
    expiresAt: payload.exp * 1000,
    rotateInSeconds: QR_ROTATE_SECONDS,
  };
}
