// Google Drive access for submissions. Files never pass through this server:
// it opens a resumable upload session per file and the student's browser
// sends the bytes straight to Google.
//
// Two ways to sign in, chosen by GOOGLE_DRIVE_MODE:
// - "oauth" (default): the lecturer's own Google account, through a refresh
//   token from `node scripts/google-auth.mjs`. Works with a personal Gmail.
// - "shared": the existing service account, on a Workspace Shared Drive it
//   has been added to. Service accounts have no storage of their own, so
//   this does not work with a folder in someone's My Drive.
import { google, type drive_v3 } from "googleapis";

export type DriveFile = {
  id: string;
  name: string;
  size: number;
  parents: string[];
};

// What the submission rules need from Drive, so tests can swap it out.
export type DriveIo = {
  rootFolderId(): string;
  createFolder(name: string, parentId: string): Promise<string>;
  renameFolder(folderId: string, name: string): Promise<void>;
  // Returns the URL the browser PUTs the file to.
  createUploadSession(file: {
    name: string;
    mime: string;
    size: number;
    parentId: string;
    // The page's origin; Drive only accepts the browser's upload from it.
    origin: string;
  }): Promise<string>;
  getFile(fileId: string): Promise<DriveFile | null>;
  // To the trash, where Drive keeps it for 30 days; not deleted outright.
  trashFile(fileId: string): Promise<void>;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
// drive.file only reaches files and folders this app created, which is all
// it needs once the setup script has made the root folder.
const OAUTH_SCOPES = ["https://www.googleapis.com/auth/drive.file"];
// A Shared Drive folder is created by a person, so the service account needs
// the wider scope to write into it.
const SHARED_SCOPES = ["https://www.googleapis.com/auth/drive"];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

type Auth = InstanceType<typeof google.auth.OAuth2> | InstanceType<typeof google.auth.JWT>;

let cached: { auth: Auth; drive: drive_v3.Drive } | undefined;

function client() {
  if (cached) return cached;
  let auth: Auth;
  if (process.env.GOOGLE_DRIVE_MODE === "shared") {
    auth = new google.auth.JWT({
      email: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      key: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      scopes: SHARED_SCOPES,
    });
  } else {
    const oauth = new google.auth.OAuth2(
      requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
      requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    );
    oauth.setCredentials({
      refresh_token: requireEnv("GOOGLE_OAUTH_REFRESH_TOKEN"),
      scope: OAUTH_SCOPES.join(" "),
    });
    auth = oauth;
  }
  cached = { auth, drive: google.drive({ version: "v3", auth }) };
  return cached;
}

function status(error: unknown): number | undefined {
  const e = error as { code?: unknown; status?: unknown };
  const value = e?.status ?? e?.code;
  return typeof value === "number" ? value : undefined;
}

export const googleDrive: DriveIo = {
  rootFolderId() {
    return requireEnv("GOOGLE_DRIVE_FOLDER_ID");
  },

  async createFolder(name, parentId) {
    const res = await client().drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
      fields: "id",
      supportsAllDrives: true,
    });
    if (!res.data.id) throw new Error(`Drive did not return an id for "${name}".`);
    return res.data.id;
  },

  async renameFolder(folderId, name) {
    await client().drive.files.update({
      fileId: folderId,
      requestBody: { name },
      supportsAllDrives: true,
    });
  },

  async createUploadSession({ name, mime, size, parentId, origin }) {
    const { token } = await client().auth.getAccessToken();
    if (!token) throw new Error("Could not get a Google access token.");
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mime,
          "X-Upload-Content-Length": String(size),
          // Makes Drive answer the browser's cross-origin PUT.
          Origin: origin,
        },
        body: JSON.stringify({ name, mimeType: mime, parents: [parentId] }),
      },
    );
    const location = res.headers.get("location");
    if (!res.ok || !location) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Drive refused the upload (${res.status}): ${detail.slice(0, 300)}`,
      );
    }
    return location;
  },

  async getFile(fileId) {
    try {
      const res = await client().drive.files.get({
        fileId,
        fields: "id,name,size,parents,trashed",
        supportsAllDrives: true,
      });
      const file = res.data;
      if (!file.id || file.trashed) return null;
      return {
        id: file.id,
        name: file.name ?? "",
        size: Number(file.size ?? -1),
        parents: file.parents ?? [],
      };
    } catch (error) {
      if (status(error) === 404) return null;
      throw error;
    }
  },

  async trashFile(fileId) {
    try {
      await client().drive.files.update({
        fileId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      });
    } catch (error) {
      // Already deleted by hand.
      if (status(error) !== 404) throw error;
    }
  },
};

export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}
