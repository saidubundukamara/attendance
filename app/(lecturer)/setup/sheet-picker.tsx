"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { connectSheet, pickerToken } from "@/lib/actions/setup";

// The parts of the Google Picker API used here.
type PickerDoc = { id: string; name?: string };
type PickerResponse = { action: string; docs?: PickerDoc[] };
type PickerBuilder = {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(cb: (r: PickerResponse) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
};
type GooglePicker = {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId: unknown) => { setMode(mode: unknown): unknown };
  ViewId: { SPREADSHEETS: unknown };
  DocsViewMode: { LIST: unknown };
  Action: { PICKED: string; CANCEL: string };
};
type Gapi = { load(name: string, cb: () => void): void };

declare global {
  interface Window {
    gapi?: Gapi;
    google?: { picker?: GooglePicker };
  }
}

let loading: Promise<GooglePicker> | undefined;

function loadPicker(): Promise<GooglePicker> {
  loading ??= new Promise((resolve, reject) => {
    const done = () =>
      window.gapi!.load("picker", () => resolve(window.google!.picker!));
    if (window.gapi) return done();
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.onload = done;
    script.onerror = () => {
      loading = undefined;
      reject(new Error("Could not load the Google Picker."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function SheetPicker({
  apiKey,
  appId,
  hasSheet,
}: {
  apiKey: string;
  appId: string;
  hasSheet: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [opening, setOpening] = useState(false);

  async function open() {
    setError(null);
    setOpening(true);
    try {
      const [picker, token] = await Promise.all([loadPicker(), pickerToken()]);
      if (!token.ok) throw new Error(token.error);
      const view = new picker.DocsView(picker.ViewId.SPREADSHEETS);
      view.setMode(picker.DocsViewMode.LIST);
      new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(token.token)
        .setDeveloperKey(apiKey)
        // Without the app id, picking doesn't grant the app access.
        .setAppId(appId)
        .setTitle("Pick your attendance sheet")
        .setCallback((response) => {
          if (response.action !== picker.Action.PICKED) return;
          const doc = response.docs?.[0];
          if (!doc) return;
          startTransition(async () => {
            const result = await connectSheet(doc.id);
            if (result?.ok) {
              setConnected(
                `Connected “${result.title}” with ${result.tabs} ${result.tabs === 1 ? "class" : "classes"}.`,
              );
              router.push("/dashboard");
            } else if (result) {
              setError(result.error);
            }
          });
        })
        .build()
        .setVisible(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <Notice role="alert" tone="danger">
          {error}
        </Notice>
      )}
      {connected && <Notice tone="ok">{connected}</Notice>}
      <Button
        type="button"
        size="lg"
        arrow
        onClick={open}
        disabled={opening || pending}
      >
        {pending
          ? "Connecting…"
          : opening
            ? "Opening Google…"
            : hasSheet
              ? "Pick a different sheet"
              : "Pick your sheet"}
      </Button>
    </div>
  );
}
