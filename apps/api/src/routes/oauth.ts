import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  buildConsentUrl,
  exchangeCodeForTokens,
  isGmailConnected,
  saveGmailConnection,
} from "@ms/integrations";
import { requireAuth } from "../auth";

// Gmail OAuth (read-only). Connecting requires an authenticated operator. The
// refresh token is stored encrypted in `connections` by saveGmailConnection.
export function registerOAuthRoutes(app: FastifyInstance): void {
  const { db, env } = app.appCtx;
  const cfg = env.integrations;

  function ensureConfigured(): string | null {
    if (!cfg.google.clientId || !cfg.google.clientSecret) {
      return "Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.";
    }
    return null;
  }

  // Status used by the frontend to show connected/disconnected.
  app.get(
    "/auth/gmail/status",
    { preHandler: requireAuth },
    async (_request, reply) => {
      const connected = await isGmailConnected(db, cfg.encryptionKey);
      return reply.send({
        connected,
        account: cfg.gmailAccount,
        configured: Boolean(cfg.google.clientId && cfg.google.clientSecret),
      });
    },
  );

  // Begin consent: redirect the operator to Google.
  app.get(
    "/auth/google",
    { preHandler: requireAuth },
    async (request, reply) => {
      const configError = ensureConfigured();
      if (configError) return reply.code(400).send({ error: configError });

      const state = randomBytes(16).toString("hex");
      request.session.oauthState = state;
      const url = buildConsentUrl(cfg.google, state);
      return reply.redirect(url);
    },
  );

  // OAuth callback: exchange code, store encrypted tokens, bounce to the web app.
  // Note: Google redirects the browser here; the operator's session cookie rides
  // along, so requireAuth still applies.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/google/callback",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { code, state, error } = request.query;
      if (error) {
        return reply.redirect(`${env.webBaseUrl}/settings?gmail=error`);
      }
      const configError = ensureConfigured();
      if (configError) return reply.code(400).send({ error: configError });

      if (!code || !state || state !== request.session.oauthState) {
        return reply.code(400).send({ error: "Invalid OAuth state or code" });
      }
      request.session.oauthState = undefined;

      const tokens = await exchangeCodeForTokens(cfg.google, code);
      if (!tokens.refresh_token) {
        // Without a refresh token we can't sync long-term; force re-consent.
        return reply.redirect(`${env.webBaseUrl}/settings?gmail=no_refresh`);
      }
      await saveGmailConnection(
        db,
        tokens,
        cfg.gmailAccount,
        cfg.encryptionKey,
      );
      return reply.redirect(`${env.webBaseUrl}/settings?gmail=connected`);
    },
  );
}
