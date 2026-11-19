import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./errors.js";

type ProblemBody = {
  type: string;
  instance: string;
  requestId: string;
  status: number;
  title: string;
  code: string;
  detail: string;
  errors?: unknown;
};

function sendProblem(reply: FastifyReply, body: ProblemBody) {
  return reply.code(body.status).type("application/problem+json").send(body);
}

function problemFor(request: FastifyRequest, status: number, code: string, detail: string) {
  return {
    type: "about:blank",
    instance: request.url,
    requestId: request.id,
    status,
    title: code,
    code,
    detail,
  };
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler(
    (error: Error & { statusCode?: number; validation?: unknown }, request, reply) => {
      if (error instanceof AppError) {
        return sendProblem(reply, problemFor(request, error.status, error.code, error.message));
      }

      if (error.validation) {
        return sendProblem(reply, {
          ...problemFor(request, 400, "VALIDATION_ERROR", "Los datos enviados no son válidos"),
          errors: error.validation,
        });
      }

      if (error.statusCode && error.statusCode < 500) {
        const code = "REQUEST_ERROR";
        return sendProblem(reply, problemFor(request, error.statusCode, code, error.message));
      }

      request.log.error({ err: error }, "unhandled error");
      return sendProblem(
        reply,
        problemFor(request, 500, "INTERNAL_ERROR", "Error interno del servidor"),
      );
    },
  );

  app.setNotFoundHandler((request, reply) =>
    sendProblem(reply, problemFor(request, 404, "NOT_FOUND", "Ruta no encontrada")),
  );
}
