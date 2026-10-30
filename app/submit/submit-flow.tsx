"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { inputClass, Label } from "@/components/ui/field";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Cross,
  Plus,
} from "@/components/ui/icons";
import { Notice } from "@/components/ui/notice";
import { RichText } from "@/components/ui/rich-text";
import { richTextPreview, withoutInstructionsLabel } from "@/lib/rich-text";
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
type Done = {
  late: boolean;
  submittedAt: number;
  files: string[];
  members: string[];
};
// A group mate added on the upload step, as the server confirmed them.
type Member = { digits: string; studentId: string; name: string };

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

// Names come from the roster as typed; capitalise each word for display.
function displayName(name: string): string {
  return name.replace(/(^|[\s'-])(\p{Ll})/gu, (_, before, letter: string) =>
    before + letter.toUpperCase(),
  );
}

// The item a shared or reloaded link points at, from ?item=<id>.
function itemFromUrl(): number | null {
  const id = Number(new URLSearchParams(window.location.search).get("item"));
  return Number.isInteger(id) && id > 0 ? id : null;
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
  const [members, setMembers] = useState<Member[]>([]);
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

  // Each step change starts at the top with focus on the step's heading, so
  // a screen reader announces where the student now is.
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const step = !student
    ? null
    : !item
      ? "list"
      : done
        ? "done"
        : `item:${item.id}`;
  useEffect(() => {
    if (step === null) return;
    window.scrollTo(0, 0);
    stepHeading.current?.focus({ preventScroll: true });
  }, [step]);

  function pick(next: StudentItem | null) {
    setItem(next);
    setFiles([]);
    setMembers([]);
    setDone(null);
    setProgress(null);
    setError(null);
  }

  // An open item lives in the URL (?item=<id>) so the phone's Back gesture
  // returns to the list instead of leaving the page and the sign-in.
  const onPopState = useEffectEvent(() => {
    if (busy) {
      // Mid-upload: stay put rather than abandon the transfer.
      if (item) window.history.pushState({ item: item.id }, "", `?item=${item.id}`);
      return;
    }
    pick(null);
  });
  useEffect(() => {
    if (!signedIn) return;
    const handler = () => onPopState();
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [signedIn]);

  function open(next: StudentItem) {
    pick(next);
    window.history.pushState({ item: next.id }, "", `?item=${next.id}`);
  }

  function close() {
    if ((window.history.state as { item?: number } | null)?.item) {
      window.history.back();
    } else {
      pick(null);
    }
  }

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
        // A link to one item opens it once the student is known, with the
        // list underneath it in the history.
        const linked = result.items.find((it) => it.id === itemFromUrl());
        window.history.replaceState(null, "", window.location.pathname);
        if (linked) open(linked);
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
    window.history.replaceState(null, "", window.location.pathname);
    setStudent(null);
    setItems([]);
    setItem(null);
    setDigits("");
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
        members: item.groupWork ? members.map((m) => m.digits) : [],
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
        members: complete.members,
      };
      setDone(result);
      setItems((all) =>
        all.map((it) =>
          it.id === item.id
            ? { ...it, submission: { ...result, submittedBy: null } }
            : it,
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
    // data-signed-in hides the page's introduction, which only matters
    // before the student is known (see app/submit/page.tsx).
    <div
      data-signed-in
      className="mt-6 flex flex-wrap items-baseline justify-between gap-2 border-b border-line pb-4"
    >
      <p>
        <span className="font-semibold">{displayName(student.name)}</span>
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

  const backButton = (
    <button
      type="button"
      onClick={close}
      disabled={busy}
      className="group -ml-2 mt-6 inline-flex h-8 items-center gap-1.5 rounded-full px-2 text-sm text-muted transition-colors duration-200 hover:text-ink"
    >
      <ArrowLeft className="size-3.5" />
      All items
    </button>
  );

  // Step 2: the class's work. Each card says whether there is a brief to
  // read, and every card opens, including finished and closed ones.
  if (!item) {
    return (
      <div className="animate-rise">
        {header}
        <h2
          ref={stepHeading}
          tabIndex={-1}
          className="mt-8 text-lg font-semibold tracking-tight outline-none"
        >
          Your work
        </h2>
        {items.length === 0 ? (
          <p className="mt-3 text-muted">Nothing has been set for this class yet.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {items.map((it) => {
              const sub = it.submission;
              const overdue = now > it.dueAt;
              const available = !sub && it.open;
              const preview = it.instructions
                ? richTextPreview(it.instructions)
                : "";
              const cue = sub
                ? "View your submission"
                : !it.open
                  ? preview
                    ? "Read the instructions"
                    : null
                  : preview
                    ? "Read the instructions and submit"
                    : "Submit";
              const ids = `item-${it.id}`;
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => open(it)}
                    aria-labelledby={`${ids}-title`}
                    aria-describedby={`${ids}-meta${preview ? ` ${ids}-brief` : ""}`}
                    className={`group w-full rounded-2xl px-4 py-3.5 text-left ring-1 ring-line transition-[transform,box-shadow] duration-300 ease-spring hover:ring-line-strong active:scale-[0.99] ${available ? "bg-surface shadow-soft" : "bg-sunken"}`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span id={`${ids}-title`} className="font-medium">
                        {it.title}
                      </span>
                      <span className="shrink-0 text-sm text-muted">
                        {KIND_LABEL[it.kind]}
                        {it.groupWork && ` · group of up to ${it.maxGroupSize}`}
                      </span>
                    </span>
                    <span id={`${ids}-meta`} className="mt-1.5 block text-sm">
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
                              <Check className="size-3.5 shrink-0" />
                              {sub.late ? "Submitted late" : "Submitted"}
                              {sub.submittedBy &&
                                ` by ${sub.submittedBy} for your group`}{" "}
                              · {formatStamp(sub.submittedAt, timeZone)}
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
                    {preview && (
                      <span
                        id={`${ids}-brief`}
                        className="mt-3 line-clamp-2 border-t border-line pt-3 text-sm text-muted"
                      >
                        {preview}
                      </span>
                    )}
                    {cue && (
                      <span
                        aria-hidden
                        className={`mt-2.5 flex items-center gap-1.5 text-sm font-medium ${available ? "text-ink" : "text-muted"}`}
                      >
                        {cue}
                        <ArrowRight className="size-3.5 transition-transform duration-300 ease-out-expo group-hover:translate-x-0.5" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // The item, finished or closed: the brief and what was handed in, to read
  // back. Nothing can be sent from here.
  if (!done && (item.submission || !item.open)) {
    return (
      <div className="animate-rise">
        {header}
        {backButton}
        <h2
          ref={stepHeading}
          tabIndex={-1}
          className="mt-3 text-2xl font-semibold tracking-tight outline-none"
        >
          {item.title}
        </h2>
        <ItemStatus item={item} now={now} timeZone={timeZone} />
        {item.instructions && <Brief text={item.instructions} />}
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
        <h2
          ref={stepHeading}
          tabIndex={-1}
          className="mt-6 text-2xl font-semibold tracking-tight outline-none"
        >
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
        {done.members.length > 1 && (
          <p className="mt-5 text-sm">
            Handed in for{" "}
            <span className="font-medium">{done.members.join(", ")}</span>.
            They don&rsquo;t need to submit it again.
          </p>
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
          onClick={close}
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
      {backButton}
      <h2
        ref={stepHeading}
        tabIndex={-1}
        className="mt-3 text-2xl font-semibold tracking-tight outline-none"
      >
        {item.title}
      </h2>
      <DeadlinePanel dueAt={item.dueAt} now={now} timeZone={timeZone} />
      {item.instructions && <Brief text={item.instructions} />}
      {item.groupWork && classId !== "" && (
        <GroupMembers
          classId={classId}
          assignmentId={item.id}
          submitter={{ digits, name: displayName(student.name) }}
          max={item.maxGroupSize ?? 1}
          members={members}
          onChange={setMembers}
          disabled={busy}
        />
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
        {!busy && (
          <p className="mb-3 text-sm">
            You can only submit once, so add every file before you press
            submit.
          </p>
        )}
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

// Green means present, open or done in this app, so a far-off deadline
// stays neutral and only the closing ones take colour.
const COUNTDOWN_TONE: Record<Urgency, string> = {
  later: "bg-sunken text-muted",
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
  later: "text-muted",
  soon: "text-warn",
  today: "text-warn",
  passed: "text-danger",
};

// The deadline at the top of the upload step: one line, coloured by how
// close it is, kept compact so the brief below starts on the first screen.
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
      className={`mt-4 rounded-2xl px-4 py-3 ring-1 ring-inset ${PANEL_TONE[left.urgency]}`}
    >
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 tabular-nums">
        <span className="font-semibold">
          <span className="font-normal text-muted">{passed ? "Was due" : "Due"}</span>{" "}
          {formatDeadline(dueAt, timeZone)}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 text-sm font-medium ${PANEL_TEXT[left.urgency]}`}
        >
          <Clock className="size-3.5 shrink-0 self-center" />
          {left.text}
        </span>
      </p>
      {passed ? (
        <p className="mt-1.5 text-sm">
          You can still submit, but it will be marked <strong>LATE</strong>.
        </p>
      ) : left.urgency === "today" ? (
        <p className="mt-1.5 text-sm">
          Less than a day to go. Anything sent after the deadline is marked
          LATE.
        </p>
      ) : null}
    </div>
  );
}

// The lecturer's brief, under a heading of its own on every item so it is
// never mistaken for small print between the deadline and the upload.
function Brief({ text }: { text: string }) {
  return (
    <section
      aria-labelledby="brief-heading"
      className="mt-5 rounded-2xl bg-surface p-4 shadow-soft ring-1 ring-line sm:p-5"
    >
      <h3 id="brief-heading" className="text-lg font-semibold tracking-tight">
        Instructions
      </h3>
      <RichText
        text={withoutInstructionsLabel(text)}
        headingLevel={4}
        className="mt-3"
      />
    </section>
  );
}

// Where a finished or closed item stands, in place of the deadline panel.
function ItemStatus({
  item,
  now,
  timeZone,
}: {
  item: StudentItem;
  now: number;
  timeZone: string;
}) {
  const sub = item.submission;
  const tone = !sub
    ? "bg-sunken ring-line"
    : sub.late
      ? "bg-warn-soft ring-warn/25"
      : "bg-accent-soft ring-accent/25";
  return (
    <div className={`mt-4 rounded-2xl px-4 py-3 ring-1 ring-inset ${tone}`}>
      {sub ? (
        <p
          className={`flex flex-wrap items-center gap-x-1.5 font-semibold ${sub.late ? "text-warn" : "text-accent-strong"}`}
        >
          <Check className="size-4 shrink-0" />
          {sub.late ? "Submitted late" : "Submitted"}
          <span className="font-normal tabular-nums">
            · {formatStamp(sub.submittedAt, timeZone)}
          </span>
        </p>
      ) : (
        <p className="font-semibold">Closed</p>
      )}
      <p className="mt-1 text-sm text-ink/75 tabular-nums">
        {now > item.dueAt ? "Was due" : "Due"}{" "}
        {formatDeadline(item.dueAt, timeZone)}
      </p>
      {sub?.submittedBy && (
        <p className="mt-1.5 text-sm">
          Handed in by {sub.submittedBy} for your group.
        </p>
      )}
      {sub && sub.members.length > 1 && !sub.submittedBy && (
        <p className="mt-1.5 text-sm">
          Handed in for {sub.members.join(", ")}.
        </p>
      )}
      {!sub && (
        <p className="mt-1.5 text-sm">
          Your lecturer has closed this item. It no longer accepts submissions.
        </p>
      )}
      {sub && sub.files.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-ink/10 pt-3 text-sm">
          {sub.files.map((name) => (
            <li key={name} className="truncate">
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The submitter and the group mates they add by the last four digits of
// their ID. Each one is checked with the server so the name shows before
// anything is sent; the start request checks them all again.
function GroupMembers({
  classId,
  assignmentId,
  submitter,
  max,
  members,
  onChange,
  disabled,
}: {
  classId: number;
  assignmentId: number;
  submitter: { digits: string; name: string };
  max: number;
  members: Member[];
  onChange: (next: Member[]) => void;
  disabled: boolean;
}) {
  const [entry, setEntry] = useState("");
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const full = members.length + 1 >= max;

  async function add() {
    if (entry.length !== 4) return;
    if (entry === submitter.digits || members.some((m) => m.digits === entry)) {
      setProblem("They're already in the group.");
      return;
    }
    setChecking(true);
    setProblem(null);
    try {
      const result = await post<
        | { code: "OK"; member: { studentId: string; name: string } }
        | { code: string; message?: string }
      >("/api/submit/member", {
        classId,
        assignmentId,
        studentId: submitter.digits,
        memberId: entry,
      });
      if (result.code === "OK" && "member" in result) {
        onChange([...members, { digits: entry, ...result.member }]);
        setEntry("");
      } else {
        setProblem(
          result.code === "NOT_FOUND"
            ? `No one with an ID ending ${entry} is in this class.`
            : message(result),
        );
      }
    } catch {
      setProblem(MESSAGES.BAD_REQUEST);
    } finally {
      setChecking(false);
    }
  }

  return (
    <section className="mt-6" aria-labelledby="group-heading">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="group-heading" className="font-semibold">
          Group members
        </h3>
        <span className="text-sm text-muted tabular-nums">
          {members.length + 1} of {max}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">
        Add everyone in your group. They&rsquo;ll all be marked as submitted,
        so only one of you hands in.
      </p>
      <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
        <li className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-sm">
          <span className="font-medium">{submitter.name}</span>
          <span className="text-muted">You</span>
        </li>
        {members.map((m) => (
          <li
            key={m.digits}
            className="flex animate-rise items-center justify-between gap-3 px-3.5 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="font-medium">{m.name}</span>{" "}
              <span className="font-mono text-xs text-muted">{m.studentId}</span>
            </span>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${m.name}`}
                onClick={() =>
                  onChange(members.filter((x) => x.digits !== m.digits))
                }
                className="shrink-0 rounded-full p-1.5 text-muted hover:bg-ink/5 hover:text-ink"
              >
                <Cross className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {full ? (
        <p className="mt-2 text-sm text-muted">
          That&rsquo;s the largest group this item allows.
        </p>
      ) : (
        !disabled && (
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void add();
            }}
          >
            <label htmlFor="member" className="sr-only">
              Last 4 digits of a group member&rsquo;s student ID
            </label>
            <span className="font-mono text-muted">{STUDENT_ID_PREFIX}</span>
            <input
              id="member"
              inputMode="numeric"
              autoComplete="off"
              pattern="\d{4}"
              maxLength={4}
              value={entry}
              onChange={(e) => {
                setEntry(e.target.value.replace(/\D/g, ""));
                setProblem(null);
              }}
              placeholder="0000"
              className={`${inputClass} w-24 font-mono tracking-[0.3em]`}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={checking || entry.length !== 4}
            >
              {!checking && <Plus className="size-3.5" />}
              {checking ? "Checking…" : "Add member"}
            </Button>
          </form>
        )
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
      )}
    </section>
  );
}
