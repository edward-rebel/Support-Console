// Configuration passed explicitly into integration functions (no env reads
// inside this package — apps own their env and inject these values).

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface IntegrationsConfig {
  google: GoogleConfig;
  encryptionKey: string;
  gmailAccount: string;
  backfillMonths: number;
}

// The Gmail scope used in Phase 0 — READ ONLY. The send/modify scopes are added
// only at Phase 3 when the guarded send path is introduced.
export const GMAIL_READONLY_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";
