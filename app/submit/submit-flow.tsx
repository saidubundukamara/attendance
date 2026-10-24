"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { inputClass, Label } from "@/components/ui/field";
import { ArrowLeft, Check, Clock, Cross } from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { RichText } from "@/components/ui/rich-text";
import { STUDENT_ID_PREFIX } from "@/lib/student-id";
import {
  ACCEPT_ATTRIBUTE,
  checkFiles,
  MAX_FILE_BYTES,
  MAX_FILES,
} from "@/lib/submission-files";
import type { LookupResult, StudentItem } from "@/lib/submissions";
import {
  formatDeadline,
  formatStamp,
  timeLeft,
  type Urgency,
} from "@/lib/timezone";

type ClassOption = { id: number; code: string; moduleName: string | null };
type Student = Extract<LookupResult, { code: "OK" }>["student"];
type Done = { late: boolean; submittedAt: number; files: string[] };

const MESSAGES: Record<string, string> = {
  NOT_FOUND: "That ID is not on this class's list. Check the class and the digits.",
  INVALID_ID: "Enter the last 4 digits of your student ID.",
  NO_ASSIGNMENT: "That item no longer exists. Go back and pick again.",
  CLOSED: "Your lecturer has closed this item. It no longer accepts submissions.",
  ALREADY_SUBMITTED: "You have already submitted this item. Each item takes one submission.",
  EXPIRED: "The upload took too long and has expired. Please try again.",
  UPLOAD_FAILED: "The upload did not go through. Check your connection and try again.",
  RATE_LIMITED: "Too many tries from this network. Wait a minute and try again.",
  BAD_REQUEST: "Something went wrong. Reload the page and try again.",
};

function message(result: { code: string; message?: string }): string {
  return result.message ?? MESSAGES[result.code] ?? MESSAGES.BAD_REQUEST;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

// Sends the file straight to Google Drive and resolves with its Drive id.
function uploadToDrive(
  url: string,
  file: File,
  onProgress: (loaded: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      try {
        const id = (JSON.parse(xhr.responseText) as { id?: string }).id;
        if (xhr.status >= 200 && xhr.status < 300 && id) resolve(id);
        else reject(new Error(`Upload failed (${xhr.status})`));
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const KIND_LABEL: Record<StudentItem["kind"], string> = {
  ASSIGNMENT: "Assignment",
  CLASSWORK: "Classwork",
  PROJECT: "Project",
};

export function SubmitFlow({
  classes,
  timeZone,
}: {
  classes: ClassOption[];
  timeZone: string;
}) {
  const [classId, setClassId] = useState<number | "">(
    classes.length === 1 ? classes[0].id : "",
  );
  const [digits, setDigits] = useState("");
  const [student, setStudent] = useState<Student | null>(null);
  const [items, setItems] = useState<StudentItem[]>([]);
  const [item, setItem] = useState<StudentItem | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number[] | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  // True while files are dragged over the drop zone.
  const [dragging, setDragging] = useState(false);
  const uploadStep = item !== null && done === null;

  // A file dropped just outside the zone would make the browser open it and
  // leave the page, losing the student's place. Swallow those drops.
  useEffect(() => {
    if (!uploadStep) return;
    const block = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, [uploadStep]);

  // The clock deadlines are judged against; moved on whenever the student
  // acts, and every half minute while the list or upload step is showing so
  // the countdowns stay true.
  const [now, setNow] = useState(() => Date.now());
  const signedIn = student !== null;
  useEffect(() => {
    if (!signedIn) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [signedIn]);
  const cls = classes.find((c) => c.id === classId);

  async function lookup() {
    if (classId === "") return;
    setNow(Date.now());
    setBusy(true);
    setError(null);
    try {
      const result = await post<LookupResult & { message?: string }>(
        "/api/submit/lookup",
        { classId, studentId: digits },
      );
      if (result.code === "OK") {
        setStudent(result.student);
        setItems(result.items);
      } else {
        setError(message(result));
      }
    } catch {
      setError(MESSAGES.UPLOAD_FAILED);
    } finally {
      setBusy(false);
    }
  }

  function signOut() {
    setStudent(null);
    setItems([]);
    setItem(null);
    setDigits("");
    setError(null);
  }

  function pick(next: StudentItem | null) {
    setItem(next);
    setFiles([]);
    setDone(null);
    setProgress(null);
    setError(null);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    const merged = [...files];
    for (const file of Array.from(list)) {
      if (!merged.some((f) => f.name === file.name && f.size === file.size)) {
        merged.push(file);
      }
    }
    setFiles(merged);
    setError(checkFiles(merged));
    if (fileInput.current) fileInput.current.value = "";
  }

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    setError(next.length ? checkFiles(next) : null);
  }

  async function submit() {
    if (!item || classId === "") return;
    const problem = checkFiles(files);
    if (problem) {
      setError(problem);
      return;
    }
    setNow(Date.now());
    setBusy(true);
    setError(null);
    try {
      type Start =
        | {
            code: "OK";
            submissionId: number;
            token: string;
            uploads: { fileId: number; uploadUrl: string }[];
          }
        | { code: string; message?: string };
      const start = await post<Start>("/api/submit/start", {
        classId,
        studentId: digits,
        assignmentId: item.id,
        files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      });
      if (start.code !== "OK" || !("uploads" in start)) {
        setError(message(start));
        return;
      }

      // One at a time: kinder to a weak connection than all at once.
      const loaded = files.map(() => 0);
      setProgress([...loaded]);
      const uploads: { fileId: number; driveFileId: string }[] = [];
      for (const [i, file] of files.entries()) {
        const driveFileId = await uploadToDrive(
          start.uploads[i].uploadUrl,
          file,
          (bytes) => {
            loaded[i] = bytes;
            setProgress([...loaded]);
          },
        );
        loaded[i] = file.size;
        setProgress([...loaded]);
        uploads.push({ fileId: start.uploads[i].fileId, driveFileId });
      }

      const complete = await post<
        (Done & { code: "OK" }) | { code: string; message?: string }
      >("/api/submit/complete", {
        submissionId: start.submissionId,
        token: start.token,
        uploads,
      });
      if (complete.code !== "OK" || !("files" in complete)) {
        setError(message(complete));
        return;
      }
      const result = {
        late: complete.late,
        submittedAt: complete.submittedAt,
        files: complete.files,
      };
      setDone(result);
      setItems((all) =>
        all.map((it) =>
          it.id === item.id ? { ...it, submission: result } : it,
        ),
      );
    } catch {
      setError(MESSAGES.UPLOAD_FAILED);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  // Step 1: class and ID.
  if (!student) {
    return (
      <form
        className="mt-10 space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          void lookup();
        }}
      >
        <div>
          <Label htmlFor="class">Class</Label>
          <select
            id="class"
            required
            value={classId}
            onChange={(e) =>
              setClassId(e.target.value ? Number(e.target.value) : "")
            }
            className={`${inputClass} w-full`}
          >
            <option value="">Choose your class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.moduleName ? `${c.code} · ${c.moduleName}` : c.code}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="studentId">Last 4 digits of your student ID</Label>
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg tracking-wider text-muted">
              {STUDENT_ID_PREFIX}
            </span>
            <input
              id="studentId"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{4}"
              maxLength={4}
              required
              value={digits}
              onChange={(e) => setDigits(e.target.value.replace(/\D/g, ""))}
              placeholder="0000"
              className={`${inputClass} w-28 font-mono text-lg tracking-[0.3em]`}
            />
          </div>
        </div>
        {error && (
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
        )}
        <Button
          type="submit"
          size="lg"
          arrow
          block
          disabled={busy || classId === "" || digits.length !== 4}
        >
          {busy ? "Checking…" : "Continue"}
        </Button>
      </form>
    );
  }

  const header = (
    <div className="mt-10 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-4">
      <p>
        <span className="font-semibold">{student.name}</span>
        <span className="ml-2 font-mono text-sm text-muted">
          {student.studentId}
        </span>
        {cls && <span className="block text-sm text-muted">{cls.code}</span>}
      </p>
      <button
        type="button"
        onClick={signOut}
        className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        Not you?
      </button>
    </div>
  );

  // Step 2: pick what to hand in.
  if (!item) {
    return (
      <div className="animate-rise">
        {header}
        <h2 className="mt-8 text-lg font-semibold tracking-tight">
          What are you submitting?
        </h2>
        {items.length === 0 ? (
          <p className="mt-3 text-muted">Nothing has been set for this class yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {items.map((it) => {
              const sub = it.submission;
              const overdue = now > it.dueAt;
              const available = !sub && it.open;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => pick(it)}
                    className="w-full rounded-2xl bg-surface px-4 py-3.5 text-left shadow-soft ring-1 ring-line transition-[transform,box-shadow] duration-300 ease-spring enabled:hover:ring-line-strong enabled:active:scale-[0.99] disabled:bg-sunken disabled:shadow-none"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{it.title}</span>
                      <span className="shrink-0 text-sm text-muted">
                        {KIND_LABEL[it.kind]}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-sm">
                      {sub || !it.open ? (
                        // Done or closed: the deadline stays on show, quieter.
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-medium text-ink/80 tabular-nums">
                            {overdue ? "Was due" : "Due"}{" "}
                            {formatDeadline(it.dueAt, timeZone)}
                          </span>
                          {sub ? (
                            <span
                              className={`inline-flex items-center gap-1 ${sub.late ? "text-warn" : "text-accent-strong"}`}
                            >
                              <Check className="size-3.5" />
                              {sub.late ? "Submitted late" : "Submitted"} ·{" "}
                              {formatStamp(sub.submittedAt, timeZone)}
                            </span>
                          ) : (
                            <span className="text-muted">Closed</span>
                          )}
                        </span>
                      ) : (
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="font-medium tabular-nums">
                            {overdue ? "Was due" : "Due"}{" "}
                            {formatDeadline(it.dueAt, timeZone)}
                          </span>
                          <Countdown dueAt={it.dueAt} now={now} />
                          {overdue && (
                            <span className="basis-full text-danger">
                              You can still submit, but it will be marked LATE.
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // Step 4: confirmation.
  if (done) {
    return (
      <div className="animate-rise">
        {header}
        <div
          className={`mt-10 flex size-16 animate-pop items-center justify-center rounded-full ${done.late ? "bg-warn-soft text-warn" : "bg-accent-soft text-accent-strong"}`}
        >
          <Check className="size-7" />
        </div>
        <h2 className="mt-6 text-2xl font-semibold tracking-tight">
          {item.title} submitted
        </h2>
        <p className="mt-1 text-muted">
          Received {formatDeadline(done.submittedAt, timeZone)}
        </p>
        {done.late && (
          <Notice tone="warn" className="mt-5">
            This was submitted after the deadline (
            {formatDeadline(item.dueAt, timeZone)}) and is marked{" "}
            <strong>LATE</strong>.
          </Notice>
        )}
        <ul className="mt-6 space-y-1 text-sm">
          {done.files.map((name) => (
            <li key={name} className="truncate">
              {name}
            </li>
          ))}
        </ul>
        <Button
          variant="secondary"
          size="lg"
          className="mt-8"
          onClick={() => pick(null)}
        >
          Back to the list
        </Button>
      </div>
    );
  }

  // Step 3: upload.
  const overdue = now > item.dueAt;
  const total = files.reduce((sum, f) => sum + f.size, 0);
  const sent = progress?.reduce((sum, n) => sum + n, 0) ?? 0;
  const label =
    files.length === 0
      ? "Submit"
      : files.length === 1
        ? "Submit 1 file"
        : `Submit ${files.length} files`;

  return (
    <div className="animate-rise">
      {header}
      <button
        type="button"
        onClick={() => pick(null)}
        disabled={busy}
        className="group -ml-2 mt-6 inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-sm text-muted transition-colors duration-200 hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        All items
      </button>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight">
        {item.title}
      </h2>
      <DeadlinePanel dueAt={item.dueAt} now={now} timeZone={timeZone} />
      {item.instructions && (
        <RichText text={item.instructions} className="mt-5 text-sm" />
      )}

      <div className="mt-6">
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          id="files"
          disabled={busy}
          onChange={(e) => addFiles(e.target.files)}
        />
        <label
          htmlFor="files"
          onDragEnter={(event) => {
            if (busy) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => {
            if (busy) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDragLeave={(event) => {
            // Ignore moves between the zone's own children.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!busy) addFiles(event.dataTransfer.files);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center transition-[background-color,border-color,transform] duration-200 ease-out-expo ${
            dragging
              ? "scale-[1.01] border-accent bg-accent-soft"
              : "border-line-strong bg-surface hover:bg-sunken"
          }`}
        >
          <span className="font-medium">
            {dragging ? "Drop to add" : "Drag files here or choose files"}
          </span>
          <span className="mt-1 text-sm text-muted">
            PDF, Word (.docx) or ZIP · up to {MAX_FILES} files, {MAX_FILE_BYTES / 1024 / 1024} MB each
          </span>
        </label>
        <p className="mt-2 text-xs text-muted">
          You can only submit once, so add every file before you press submit.
        </p>
      </div>

      {files.length > 0 && (
        <ul className="mt-4 space-y-2">
          {files.map((file, i) => {
            const pct = progress
              ? Math.round(((progress[i] ?? 0) / file.size) * 100)
              : null;
            return (
              <li
                key={`${file.name}:${file.size}`}
                className="relative overflow-hidden rounded-xl bg-surface px-3.5 py-2.5 ring-1 ring-line"
              >
                {pct !== null && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-accent-soft transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                  />
                )}
                <span className="relative flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{file.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-muted tabular-nums">
                    {pct !== null ? `${pct}%` : formatSize(file.size)}
                    {!busy && (
                      <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => removeFile(i)}
                        className="rounded-full p-1 hover:bg-ink/5 hover:text-ink"
                      >
                        <Cross className="size-3.5" />
                      </button>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <Notice tone="danger" role="alert" className="mt-5">
          {error}
        </Notice>
      )}

      <div className="mt-6">
        {busy ? (
          <p role="status" className="text-sm text-muted tabular-nums">
            {progress
              ? `Uploading… ${formatSize(sent)} of ${formatSize(total)}`
              : "Preparing upload…"}
          </p>
        ) : overdue && files.length > 0 && !checkFiles(files) ? (
          <ConfirmButton
            label={`${label} late`}
            question="It will be marked LATE. Submit anyway?"
            confirmLabel="Submit late"
            variant="secondary"
            onConfirm={() => void submit()}
          />
        ) : (
          <Button
            size="lg"
            arrow
            block
            disabled={files.length === 0 || Boolean(checkFiles(files))}
            onClick={() => void submit()}
          >
            {overdue ? `${label} late` : label}
          </Button>
        )}
      </div>
    </div>
  );
}

const COUNTDOWN_TONE: Record<Urgency, string> = {
  later: "bg-accent-soft text-accent-strong",
  soon: "bg-warn-soft text-warn",
  today: "bg-warn-soft text-warn",
  passed: "bg-danger-soft text-danger",
};

// "2 days 5 h left" as a pill whose colour warms as the deadline nears.
function Countdown({ dueAt, now }: { dueAt: number; now: number }) {
  const left = timeLeft(dueAt, now);
  return (
    <span
      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium tabular-nums ${COUNTDOWN_TONE[left.urgency]}`}
    >
      <Clock className="size-3.5" />
      {left.text}
    </span>
  );
}

const PANEL_TONE: Record<Urgency, string> = {
  later: "bg-surface ring-line",
  soon: "bg-warn-soft ring-warn/25",
  today: "bg-warn-soft ring-warn/25",
  passed: "bg-danger-soft ring-danger/25",
};

const PANEL_TEXT: Record<Urgency, string> = {
  later: "text-accent-strong",
  soon: "text-warn",
  today: "text-warn",
  passed: "text-danger",
};

// The deadline at the top of the upload step: the date large enough to
// register, and how long is left in the colour of its urgency.
function DeadlinePanel({
  dueAt,
  now,
  timeZone,
}: {
  dueAt: number;
  now: number;
  timeZone: string;
}) {
  const left = timeLeft(dueAt, now);
  const passed = left.urgency === "passed";
  return (
    <div
      className={`mt-4 rounded-2xl px-4 py-3.5 ring-1 ring-inset ${PANEL_TONE[left.urgency]}`}
    >
      <p className="text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
        <span className="font-normal text-muted">{passed ? "Was due" : "Due"}</span>{" "}
        {formatDeadline(dueAt, timeZone)}
      </p>
      <p
        className={`mt-1 flex items-center gap-1.5 font-medium tabular-nums ${PANEL_TEXT[left.urgency]}`}
      >
        <Clock className="size-4 shrink-0" />
        {left.text}
      </p>
      {passed ? (
        <p className="mt-2 text-sm">
          You can still submit, but it will be marked <strong>LATE</strong>.
        </p>
      ) : left.urgency === "today" ? (
        <p className="mt-2 text-sm">
          Less than a day to go. Anything sent after the deadline is marked
          LATE.
        </p>
      ) : null}
    </div>
  );
}
