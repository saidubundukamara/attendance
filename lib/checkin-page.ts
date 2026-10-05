// HTML for the student check-in page. Built as plain strings so the page is
// a single small response with no framework, fonts or images. The few lines
// of script only polish the ID field; the form works without them.
import type { CheckInCode } from "./checkin";
import {
  STUDENT_ID_PREFIX,
  STUDENT_ID_SUFFIX_LENGTH,
  studentIdSuffix,
} from "./student-id";

export type SessionLabel = {
  moduleName: string | null;
  classCode: string;
  week: number;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Colours and easing mirror app/globals.css; this page cannot import it.
const STYLE = `
@view-transition{navigation:auto}
*{box-sizing:border-box}
:root{--ink:#0d1210;--mut:#56605a;--line:rgb(13 18 16/.16);--ok:#0c7a4a;--oks:#e0f2e8;--bad:#b42318;--bads:#fbe8e5;--warn:#8a5600;--warns:#faf0d9;--e:cubic-bezier(.16,1,.3,1);--s:cubic-bezier(.32,.72,0,1);--w:clamp(2.75rem,13.5vw,3.5rem);--g:.5rem;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100dvh;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f3f5f3;color:var(--ink);line-height:1.45;-webkit-font-smoothing:antialiased;caret-color:var(--ok)}
::selection{background:var(--oks)}
main{max-width:24rem;margin:0 auto;padding:clamp(2.5rem,12vh,6rem) 1.25rem 2rem}
main>*,form>*{animation:rise .7s var(--e) both}
form>:nth-child(3){animation-delay:.06s}
form>:nth-child(n+4){animation-delay:.12s}
h1{font-size:1.9rem;line-height:1.1;letter-spacing:-.03em;font-weight:650;margin:0;text-wrap:balance}
.sub{color:var(--mut);margin:.5rem 0 0}
form{margin-top:2.5rem}
.lab{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:.6rem}
label{font-weight:600}
.hint{color:var(--mut);font-size:.875rem}
.id{display:flex;align-items:center;gap:.6rem}
.pre{font:500 1.25rem/1 var(--mono);color:var(--mut);letter-spacing:.04em}
.slots{position:relative;display:flex;gap:var(--g);overflow:hidden;overflow:clip;padding:2px;margin:-2px}
.slots i{width:var(--w);height:calc(var(--w)*1.2);border-radius:.85rem;background:#fff;box-shadow:inset 0 0 0 1px var(--line);transition:box-shadow .25s var(--e),transform .35s var(--s)}
.slots i.on{box-shadow:inset 0 0 0 1.5px var(--ink)}
.slots:focus-within i.cur,.nojs .slots:focus-within i{box-shadow:inset 0 0 0 2px var(--ink)}
.slots i.on{animation:pop .35s var(--s)}
.slots input{position:absolute;inset:2px auto 2px 2px;width:calc(100% + var(--w));border:0;outline:0;background:none;color:var(--ink);font:600 1.6rem/1 var(--mono);padding:0 0 0 calc((var(--w) - 1ch)/2);letter-spacing:calc(var(--w) + var(--g) - 1ch)}
.bad .slots{animation:shake .45s var(--s)}
.bad .slots i{box-shadow:inset 0 0 0 1.5px var(--bad)}
.err{color:var(--bad);font-weight:500;margin:.85rem 0 0}
button{display:flex;align-items:center;justify-content:space-between;width:100%;margin-top:1.75rem;height:3.5rem;padding:0 .5rem 0 1.5rem;border:0;border-radius:99px;background:var(--ink);color:#fff;font:600 1.0625rem/1 inherit;transition:transform .3s var(--s),opacity .3s var(--e)}
button:active{transform:scale(.97)}
button:disabled{opacity:.35}
button:focus-visible{outline:2px solid var(--ink);outline-offset:3px}
.arr{display:flex;align-items:center;justify-content:center;width:2.5rem;height:2.5rem;border-radius:50%;background:rgb(255 255 255/.15);transition:transform .3s var(--s)}
button:not(:disabled) .arr{transform:translateX(0)}
button:disabled .arr{transform:translateX(-.25rem)}
svg{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}
.badge{display:flex;align-items:center;justify-content:center;width:4.5rem;height:4.5rem;border-radius:50%;margin-bottom:1.75rem;animation:pop .6s var(--s) both}
.badge svg{width:2rem;height:2rem;stroke-width:2}
.badge path{stroke-dasharray:1;stroke-dashoffset:1;animation:draw .6s var(--e) .25s forwards}
.ok{background:var(--oks);color:var(--ok)}.warn{background:var(--warns);color:var(--warn)}.no{background:var(--bads);color:var(--bad)}
.who{font-size:1.125rem;font-weight:600;margin:1.25rem 0 0}
.msg{color:var(--mut);margin:.75rem 0 0;max-width:20rem}
@keyframes rise{from{opacity:0;transform:translateY(10px)}}
@keyframes pop{from{opacity:0;transform:scale(.85)}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes shake{20%{transform:translateX(-6px)}40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(2px)}}
@media(prefers-reduced-motion:reduce){*{animation-duration:.01ms!important;animation-delay:0s!important;transition-duration:.01ms!important}}
`.replace(/\n/g, "");

// Keeps the field to the four digits, lights the slots, and guards against
// a double tap on submit.
const SCRIPT = `
(function(){var f=document.forms[0],i=f.studentId,b=f.querySelector('button'),t=b.firstChild,s=f.querySelectorAll('.slots i'),p='${STUDENT_ID_PREFIX}',n=${STUDENT_ID_SUFFIX_LENGTH};
document.documentElement.className='';
function u(){var v=i.value.replace(/\\D/g,'');if(v.indexOf(p)==0)v=v.slice(p.length);v=v.slice(0,n);if(i.value!=v)i.value=v;
for(var k=0;k<n;k++){var c=k<v.length?'on':k==v.length?'cur':'';if(s[k].className!=c)s[k].className=c}
b.disabled=v.length<n;t.textContent='Check in'}
i.addEventListener('input',function(){u();f.className=''});
f.addEventListener('submit',function(){b.disabled=true;t.textContent='Checking in\\u2026'});
window.addEventListener('pageshow',u);u()})()
`.replace(/\n/g, "");

function layout(title: string, body: string, script = ""): string {
  return (
    `<!doctype html><html lang="en"${script ? ' class="nojs"' : ""}><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">` +
    `<meta name="theme-color" content="#f3f5f3"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head>` +
    `<body><main>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`
  );
}

function sessionName(session: SessionLabel): string {
  return session.moduleName ?? session.classCode;
}

const ARROW = `<svg viewBox="0 0 16 16" width="16" height="16" stroke-width="1.6" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>`;

export function renderForm(options: {
  session: SessionLabel;
  pass: string;
  error?: string;
  // What the student typed last time; only the last four digits are shown.
  value?: string;
}): string {
  const { session, pass, error, value } = options;
  const suffix = studentIdSuffix((value ?? "").replace(/\D/g, ""));
  const slots = "<i></i>".repeat(STUDENT_ID_SUFFIX_LENGTH);
  return layout(
    `Week ${session.week} attendance`,
    `<h1>Week ${session.week} attendance</h1>` +
      `<p class="sub">${escapeHtml(sessionName(session))}</p>` +
      `<form method="post" action="/a" autocomplete="off"${error ? ' class="bad"' : ""}>` +
      `<input type="hidden" name="pass" value="${escapeHtml(pass)}">` +
      `<div class="lab"><label for="studentId">Student ID</label><span class="hint" id="hint">Last 4 digits</span></div>` +
      `<div class="id"><span class="pre" aria-hidden="true">${STUDENT_ID_PREFIX}</span>` +
      `<div class="slots">${slots}` +
      `<input id="studentId" name="studentId" inputmode="numeric" pattern="[0-9]{4}|[0-9]{9}" maxlength="9" required autofocus autocomplete="off" aria-describedby="hint${error ? " err" : ""}" value="${escapeHtml(suffix)}">` +
      `</div></div>` +
      (error ? `<p class="err" id="err" role="alert">${escapeHtml(error)}</p>` : "") +
      `<button type="submit"><span>Check in</span><span class="arr">${ARROW}</span></button>` +
      `</form>`,
    SCRIPT,
  );
}

const ICONS = {
  check: "m5 12.5 4.5 4.5L19 7",
  cross: "m6.5 6.5 11 11m0-11-11 11",
  bang: "M12 5.5v8m0 4v.1",
  refresh: "M19 12a7 7 0 1 1-2.2-5.1M19 4v4h-4",
};

type Message = {
  icon: keyof typeof ICONS;
  tone: "ok" | "warn" | "no";
  title: string;
  text: string;
};

function message(
  code: Exclude<CheckInCode, "NOT_FOUND" | "INVALID_ID">,
  session: SessionLabel | null,
): Message {
  const week = session ? `Week ${session.week}` : "this session";
  switch (code) {
    case "OK":
      return {
        icon: "check",
        tone: "ok",
        title: "You’re checked in",
        text: `Your attendance for ${week} has been recorded. You can close this page.`,
      };
    case "ALREADY":
      return {
        icon: "check",
        tone: "ok",
        title: "Already checked in",
        text: `Your attendance for ${week} was recorded earlier. Nothing more to do.`,
      };
    case "DEVICE_USED":
      return {
        icon: "bang",
        tone: "no",
        title: "This phone was already used",
        text: "Another student has checked in to this class from this phone. Please see your lecturer.",
      };
    case "CLOSED":
      return {
        icon: "cross",
        tone: "warn",
        title: "Attendance is closed",
        text: "This session is no longer accepting check-ins. Please see your lecturer.",
      };
    case "RATE_LIMITED":
      return {
        icon: "bang",
        tone: "no",
        title: "Too many attempts",
        text: "This phone has tried too many times. Please see your lecturer.",
      };
    case "EXPIRED":
      return {
        icon: "refresh",
        tone: "warn",
        title: "This QR code has expired",
        text: "Scan the code currently shown in the classroom and try again.",
      };
  }
}

export function renderResult(
  code: Exclude<CheckInCode, "NOT_FOUND" | "INVALID_ID">,
  session: SessionLabel | null,
  studentName: string | null = null,
): string {
  const m = message(code, session);
  return layout(
    m.title,
    `<div class="badge ${m.tone}"><svg viewBox="0 0 24 24" aria-hidden="true"><path pathLength="1" d="${ICONS[m.icon]}"/></svg></div>` +
      `<h1>${escapeHtml(m.title)}</h1>` +
      (session
        ? `<p class="sub">${escapeHtml(sessionName(session))} · Week ${session.week}</p>`
        : "") +
      (studentName ? `<p class="who">${escapeHtml(studentName)}</p>` : "") +
      `<p class="msg">${escapeHtml(m.text)}</p>`,
  );
}

// Shown under the field when the ID is malformed or not on the class list.
export function idErrorMessage(
  code: "NOT_FOUND" | "INVALID_ID",
  entered: string | null,
): string {
  const suffix = studentIdSuffix((entered ?? "").replace(/\D/g, ""));
  if (code === "INVALID_ID" || !suffix) {
    return code === "INVALID_ID"
      ? "Enter the last 4 digits of your student ID."
      : "That student ID is not on this class list. Check it and try again.";
  }
  return `${STUDENT_ID_PREFIX} ${suffix} is not on this class list. Check the last 4 digits and try again.`;
}
