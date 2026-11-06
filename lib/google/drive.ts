// Google Drive access for submissions, in each lecturer's own Drive. Files
// never pass through this server: it opens a resumable upload session per
// file and the student's browser sends the bytes straight to Google.
//
// The app has the drive.file scope, so it only reaches files and folders it
// created. It makes an "Assignment Submissions" folder in the lecturer's My
// Drive on first use and puts everything under it.
import { and, eq, isNull } from "drizzle-orm";
import { google, type drive_v3 } from "googleapis";
import { db } from "@/lib/db";
import { lecturers } from "@/lib/db/schema";
import { googleAuthFor, noteGoogleFailure } from "@/lib/google/auth";
import type { Lecturer } from "@/lib/lecturers";

export type DriveFile = {
  id: string;
  name: string;
  size: number;
  parents: string[];
};

// What the submission rules need from Drive, so tests can swap it out.
export type DriveIo = {
  rootFolderId(): Promise<string>;
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
export const ROOT_FOLDER_NAME = "Assignment Submissions";

function status(error: unknown): number | undefined {
  const e = error as { code?: unknown; status?: unknown };
  const value = e?.status ?? e?.code;
  return typeof value === "number" ? value : undefined;
}

type DriveLecturer = Pick<Lecturer, "id" | "refreshTokenEnc" | "driveFolderId">;

export function driveFor(lecturer: DriveLecturer): DriveIo {
  const auth = googleAuthFor(lecturer);
  const drive: drive_v3.Drive = google.drive({ version: "v3", auth });
  let rootId = lecturer.driveFolderId;

  // Runs a Drive call, noting a revoked Google grant on the lecturer.
  async function call<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      return noteGoogleFailure(lecturer.id, error);
    }
  }

  async function createFolder(name: string, parentId?: string) {
    const res = await call(() =>
      drive.files.create({
        requestBody: {
          name,
          mimeType: FOLDER_MIME,
          ...(parentId ? { parents: [parentId] } : {}),
        },
        fields: "id",
      }),
    );
    if (!res.data.id) throw new Error(`Drive did not return an id for "${name}".`);
    return res.data.id;
  }

  return {
    async rootFolderId() {
      if (rootId) return rootId;
      const created = await createFolder(ROOT_FOLDER_NAME);
      // Two first uploads at once may both make one; the first saved wins.
      await db
        .update(lecturers)
        .set({ driveFolderId: created })
        .where(and(eq(lecturers.id, lecturer.id), isNull(lecturers.driveFolderId)))
        .run();
      const saved = await db
        .select({ id: lecturers.driveFolderId })
        .from(lecturers)
        .where(eq(lecturers.id, lecturer.id))
        .get();
      rootId = saved?.id ?? created;
      return rootId;
    },

    createFolder,

    async renameFolder(folderId, name) {
      await call(() =>
        drive.files.update({ fileId: folderId, requestBody: { name } }),
      );
    },

    async createUploadSession({ name, mime, size, parentId, origin }) {
      const { token } = await call(() => auth.getAccessToken());
      if (!token) throw new Error("Could not get a Google access token.");
      const res = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
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
        const res = await drive.files.get({
          fileId,
          fields: "id,name,size,parents,trashed",
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
        return noteGoogleFailure(lecturer.id, error);
      }
    },

    async trashFile(fileId) {
      try {
        await drive.files.update({ fileId, requestBody: { trashed: true } });
      } catch (error) {
        // Already deleted by hand.
        if (status(error) !== 404) await noteGoogleFailure(lecturer.id, error);
      }
    },
  };
}

export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}
