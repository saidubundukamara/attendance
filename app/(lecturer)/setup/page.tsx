import { requireLecturer } from "@/lib/auth";
import { Notice } from "@/components/ui/notice";
import { SheetPicker } from "./sheet-picker";

export const metadata = { title: "Connect your sheet — Attendance" };

export default async function SetupPage() {
  const lecturer = await requireLecturer();
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
  const appId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID ?? "";

  return (
    <div className="stagger mx-auto max-w-xl">
      <h1 className="text-4xl font-semibold tracking-tight">
        {lecturer.sheetId ? "Your attendance sheet" : "Connect your attendance sheet"}
      </h1>
      <p className="mt-3 text-muted" style={{ "--i": 1 } as React.CSSProperties}>
        Pick the Google Sheet that holds your class lists. Each class needs
        its own tab named{" "}
        <span className="font-medium text-ink">Attn of &lt;CLASS CODE&gt;</span>
        , for example{" "}
        <span className="font-medium text-ink">Attn of BIT2101</span>, with an{" "}
        <span className="font-medium text-ink">ID Number</span> column and a
        column per week. The app only gets access to the sheet you pick.
      </p>

      {lecturer.sheetId && (
        <p className="mt-6 text-sm" style={{ "--i": 2 } as React.CSSProperties}>
          Connected:{" "}
          <a
            href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(lecturer.sheetId)}/edit`}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline underline-offset-4"
          >
            {lecturer.sheetName || "your sheet"}
          </a>
        </p>
      )}

      <div className="mt-8" style={{ "--i": 3 } as React.CSSProperties}>
        {apiKey && appId ? (
          <SheetPicker
            apiKey={apiKey}
            appId={appId}
            hasSheet={Boolean(lecturer.sheetId)}
          />
        ) : (
          <Notice role="alert">
            The Google Picker isn&apos;t configured. Set
            NEXT_PUBLIC_GOOGLE_API_KEY and NEXT_PUBLIC_GOOGLE_APP_ID.
          </Notice>
        )}
      </div>
    </div>
  );
}
