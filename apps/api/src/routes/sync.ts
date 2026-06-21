import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth";
import type { SyncRunner } from "../sync-runner";

// Wires the shared SyncRunner to the manual-trigger endpoints used by the
// design's Sync button + header pill.
export function registerSyncRoutes(
  app: FastifyInstance,
  runner: SyncRunner,
): void {
  app.post("/sync", { preHandler: requireAuth }, async (_request, reply) => {
    const started = runner.start((msg, err) => {
      if (err) app.log.error({ err }, msg);
      else app.log.info(msg);
    });
    return reply.send({ started, ...runner.status });
  });

  app.get(
    "/sync/status",
    { preHandler: requireAuth },
    async (_request, reply) => {
      return reply.send(runner.status);
    },
  );
}
