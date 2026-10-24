// Which files students may hand in. Pure, so the upload page can check files
// before sending them and the server can check them again.

export const ALLOWED_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
} as const;
export type AllowedExtension = keyof typeof ALLOWED_TYPES;
export const ACCEPT_ATTRIBUTE = ".pdf,.docx,.zip";
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
// Browsers report these types for the same files, depending on the OS.
const ACCEPTED_MIMES: Record<AllowedExtension, string[]> = {
  pdf: ["application/pdf", "application/x-pdf"],
  docx: [ALLOWED_TYPES.docx],
  zip: [
    "application/zip",
    "application/x-zip",
    "application/x-zip-compressed",
    "multipart/x-zip",
  ],
};
// What a browser reports when it does not know.
const UNKNOWN_MIMES = ["", "application/octet-stream"];

export type FileMeta = { name: string; size: number; type: string };

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isAllowedExtension(ext: string): ext is AllowedExtension {
  return Object.hasOwn(ALLOWED_TYPES, ext);
}

// Keeps the base name only, drops control and path characters, and keeps
// the extension when shortening.
export function cleanFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (base.length <= 120) return base;
  const ext = fileExtension(base);
  return `${base.slice(0, 115 - ext.length).trimEnd()}….${ext}`;
}

// Null when the files are acceptable, otherwise a message for the student.
export function checkFiles(files: FileMeta[]): string | null {
  if (files.length === 0) return "Choose at least one file.";
  if (files.length > MAX_FILES) {
    return `You can upload up to ${MAX_FILES} files at once.`;
  }
  for (const file of files) {
    const name = cleanFileName(file.name);
    const ext = fileExtension(name);
    if (!name || !isAllowedExtension(ext)) {
      return `"${name || "That file"}" is not a PDF, Word (.docx) or ZIP file.`;
    }
    const type = file.type.toLowerCase();
    if (!ACCEPTED_MIMES[ext].includes(type) && !UNKNOWN_MIMES.includes(type)) {
      return `"${name}" does not look like a real .${ext} file.`;
    }
    if (!Number.isInteger(file.size) || file.size <= 0) {
      return `"${name}" is empty.`;
    }
    if (file.size > MAX_FILE_BYTES) {
      return `"${name}" is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`;
    }
  }
  return null;
}

