import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { eq } from "drizzle-orm";
import { connections, type Db } from "@ms/db";
import { GMAIL_READONLY_SCOPE, type GoogleConfig } from "./config";
import { decryptJson, encryptJson, type EncryptedPayload } from "./crypto";

// The token bundle we persist (encrypted). We rely on the refresh_token for
// long-lived access; the access_token is short-lived and refreshed on demand.
export interface StoredGmailTokens {
  refresh_token?: string | null;
  access_token?: string | null;
  scope?: string | null;
  token_type?: string | null;
  expiry_date?: number | null;
}

export function makeOAuthClient(cfg: GoogleConfig): OAuth2Client {
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
}

// Build the consent URL. `access_type=offline` + `prompt=consent` ensures we
// receive a refresh_token (Google only returns it on first consent unless we
// force it).
export function buildConsentUrl(cfg: GoogleConfig, state: string): string {
  const client = makeOAuthClient(cfg);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [GMAIL_READONLY_SCOPE],
    state,
  });
}

export async function exchangeCodeForTokens(
  cfg: GoogleConfig,
  code: string,
): Promise<StoredGmailTokens> {
  const client = makeOAuthClient(cfg);
  const { tokens } = await client.getToken(code);
  return tokens as StoredGmailTokens;
}

// Persist (or update) the single Gmail connection row, tokens encrypted at rest.
// Merges with any existing refresh_token so a re-consent that omits it doesn't
// wipe the stored one.
export async function saveGmailConnection(
  db: Db,
  tokens: StoredGmailTokens,
  accountIdentifier: string,
  encryptionKey: string,
): Promise<void> {
  const existing = await loadGmailTokens(db, encryptionKey);
  const merged: StoredGmailTokens = {
    ...existing,
    ...tokens,
    refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
  };
  const encrypted = encryptJson(merged, encryptionKey);
  await db
    .insert(connections)
    .values({
      provider: "gmail",
      encryptedTokens: encrypted,
      accountIdentifier,
      status: "connected",
    })
    .onConflictDoUpdate({
      target: connections.provider,
      set: {
        encryptedTokens: encrypted,
        accountIdentifier,
        status: "connected",
        updatedAt: new Date(),
      },
    });
}

export async function loadGmailTokens(
  db: Db,
  encryptionKey: string,
): Promise<StoredGmailTokens | null> {
  const rows = await db
    .select({ encryptedTokens: connections.encryptedTokens })
    .from(connections)
    .where(eq(connections.provider, "gmail"))
    .limit(1);
  const row = rows[0];
  if (!row?.encryptedTokens) return null;
  return decryptJson<StoredGmailTokens>(
    row.encryptedTokens as EncryptedPayload,
    encryptionKey,
  );
}

// Returns an authorized OAuth2 client for the stored Gmail connection, or null
// if Gmail isn't connected yet. The googleapis client auto-refreshes the access
// token from the refresh_token as needed.
export async function getAuthorizedClient(
  db: Db,
  cfg: GoogleConfig,
  encryptionKey: string,
): Promise<OAuth2Client | null> {
  const tokens = await loadGmailTokens(db, encryptionKey);
  if (!tokens?.refresh_token) return null;
  const client = makeOAuthClient(cfg);
  client.setCredentials({
    refresh_token: tokens.refresh_token ?? undefined,
    access_token: tokens.access_token ?? undefined,
    scope: tokens.scope ?? undefined,
    token_type: tokens.token_type ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
  });
  return client;
}

export async function isGmailConnected(
  db: Db,
  encryptionKey: string,
): Promise<boolean> {
  const tokens = await loadGmailTokens(db, encryptionKey);
  return Boolean(tokens?.refresh_token);
}
