// One-time setup for storing submissions in your own Google Drive.
// Signs in to Google in your browser, creates the "Assignment Submissions"
// folder, and prints the values to put in .env.local and on Vercel.
//
// Needs GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET (a "Desktop
// app" OAuth client) in .env.local first. See the README.
//
//   node scripts/google-auth.mjs
import fs from "node:fs";
import http from "node:http";
import { google } from "googleapis";

for (const envFile of [".env.local", ".env"]) {
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
}

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error(
    "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env.local first.",
  );
  process.exit(1);
}

const FOLDER_NAME = process.argv[2] ?? "Assignment Submissions";

// Google sends the browser back here with the sign-in code. A fixed port so
// a "Web application" client works too: add this address to its authorised
// redirect URIs. ("Desktop app" clients accept it without that step.)
const PORT = Number(process.env.GOOGLE_AUTH_PORT ?? 53682);
const redirectUri = `http://127.0.0.1:${PORT}`;
const server = http.createServer();
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(PORT, "127.0.0.1", resolve);
});

const oauth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const authUrl = oauth.generateAuthUrl({
  access_type: "offline",
  // Always ask, so Google returns a refresh token even on a second run.
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive.file"],
});

console.log("\nOpen this link, sign in with the Google account that should hold the files:\n");
console.log(authUrl, "\n");

const code = await new Promise((resolve, reject) => {
  server.on("request", (req, res) => {
    const url = new URL(req.url ?? "/", redirectUri);
    const value = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (!value && !error) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      value
        ? "Signed in. You can close this tab and go back to the terminal."
        : `Sign-in failed: ${error}`,
    );
    server.close();
    if (value) resolve(value);
    else reject(new Error(error ?? "Sign-in failed"));
  });
});

const { tokens } = await oauth.getToken(code);
if (!tokens.refresh_token) {
  console.error("Google did not return a refresh token. Run the script again.");
  process.exit(1);
}
oauth.setCredentials(tokens);

// drive.file only reaches what this app creates, so the app makes the
// root folder itself. It appears in your My Drive.
const drive = google.drive({ version: "v3", auth: oauth });
const folder = await drive.files.create({
  requestBody: {
    name: FOLDER_NAME,
    mimeType: "application/vnd.google-apps.folder",
  },
  fields: "id,webViewLink",
});

console.log(`Created the folder "${FOLDER_NAME}": ${folder.data.webViewLink}\n`);
console.log("Add these to .env.local and to your Vercel project:\n");
console.log("GOOGLE_DRIVE_MODE=oauth");
console.log(`GOOGLE_DRIVE_FOLDER_ID=${folder.data.id}`);
console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
