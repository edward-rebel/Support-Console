import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "@ms/db";
import type { OperatorDTO } from "@ms/shared";

// Guard for authenticated routes. Use as a preHandler.
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.session.userId) {
    return reply.code(401).send({ error: "Not authenticated" });
  }
}

export function registerAuthRoutes(app: FastifyInstance): void {
  const { db } = app.appCtx;

  app.post<{ Body: { email?: string; password?: string } }>(
    "/auth/login",
    async (request, reply) => {
      const email = request.body?.email?.toLowerCase().trim();
      const password = request.body?.password;
      if (!email || !password) {
        return reply.code(400).send({ error: "Email and password required" });
      }

      const rows = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      const user = rows[0];

      // Constant-ish failure: same response whether the email or password is
      // wrong, to avoid leaking which one.
      const ok = user
        ? await bcrypt.compare(password, user.passwordHash)
        : false;
      if (!user || !ok) {
        return reply.code(401).send({ error: "Invalid credentials" });
      }

      request.session.userId = user.id;
      const dto: OperatorDTO = { id: user.id, email: user.email };
      return reply.send(dto);
    },
  );

  app.post("/auth/logout", async (request, reply) => {
    await request.session.destroy();
    return reply.send({ ok: true });
  });

  app.get("/auth/me", async (request, reply) => {
    const userId = request.session.userId;
    if (!userId) return reply.code(401).send({ error: "Not authenticated" });
    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = rows[0];
    if (!user) {
      await request.session.destroy();
      return reply.code(401).send({ error: "Not authenticated" });
    }
    const dto: OperatorDTO = { id: user.id, email: user.email };
    return reply.send(dto);
  });
}
