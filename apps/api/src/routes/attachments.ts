import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { messages } from "@ms/db";
import { fetchAttachmentBytes } from "@ms/integrations";
import { requireAuth } from "../auth";

interface StoredAttachment {
  attachmentId: string | null;
  filename: string;
  mimeType: string;
}

// Stream an attachment's bytes from Gmail on demand (read-only). The metadata is
// already stored on the message; we only fetch bytes when the operator clicks.
export function registerAttachmentRoutes(app: FastifyInstance): void {
  const { db, env } = app.appCtx;
  const cfg = env.integrations;

  app.get<{ Params: { messageId: string; attachmentId: string } }>(
    "/messages/:messageId/attachments/:attachmentId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { messageId, attachmentId } = request.params;
      const rows = await db
        .select({ attachments: messages.attachments })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      const list = (rows[0]?.attachments ?? []) as StoredAttachment[];
      const meta = Array.isArray(list)
        ? list.find((a) => a.attachmentId === attachmentId)
        : null;
      if (!meta) return reply.code(404).send({ error: "Attachment not found" });

      try {
        const bytes = await fetchAttachmentBytes(db, cfg, messageId, attachmentId);
        if (!bytes) {
          return reply.code(502).send({ error: "Could not fetch attachment." });
        }
        // Force download, never inline render; sanitize the filename header.
        const safeName = meta.filename.replace(/[\r\n"\\]/g, "_").slice(0, 200);
        reply.header("Content-Type", meta.mimeType || "application/octet-stream");
        reply.header(
          "Content-Disposition",
          `attachment; filename="${safeName}"`,
        );
        return reply.send(bytes);
      } catch (err) {
        app.log.error({ err }, "Attachment fetch failed");
        return reply.code(502).send({ error: "Could not fetch attachment." });
      }
    },
  );
}
