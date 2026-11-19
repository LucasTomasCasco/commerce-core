import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { PERMISSIONS } from "../domain/permissions.js";
import { requireStoreAccess } from "../http/guards.js";
import { currentAuth, requireSession } from "../http/session.js";

const permissionSchema = z.enum(PERMISSIONS);
const uuidParam = z.object({ storeId: z.uuid() });
const memberParams = z.object({ storeId: z.uuid(), memberId: z.uuid() });
const roleParams = z.object({ storeId: z.uuid(), roleId: z.uuid() });

const memberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  roleId: z.uuid(),
  roleName: z.string(),
  isOwner: z.boolean(),
  createdAt: z.date(),
});

const roleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  permissions: z.array(permissionSchema),
  isSystem: z.boolean(),
});

export const teamRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const auth = app.services.auth;
  const team = app.services.team;
  const guard = [requireSession(auth), requireStoreAccess(app.db, "team:manage")];

  app.get(
    "/stores/:storeId/members",
    {
      preHandler: guard,
      schema: {
        tags: ["team"],
        summary: "Miembros de la tienda",
        params: uuidParam,
        response: { 200: z.object({ members: z.array(memberSchema) }) },
      },
    },
    async (request) => ({ members: await team.listMembers(request.params.storeId) }),
  );

  app.post(
    "/stores/:storeId/invitations",
    {
      preHandler: guard,
      schema: {
        tags: ["team"],
        summary: "Invitar staff por email con un rol",
        params: uuidParam,
        body: z.object({ email: z.email(), roleId: z.uuid() }),
        response: { 202: z.null() },
      },
    },
    async (request, reply) => {
      await team.inviteStaff({
        storeId: request.params.storeId,
        actorUserId: currentAuth(request).user.id,
        email: request.body.email,
        roleId: request.body.roleId,
      });
      return reply.code(202).send(null);
    },
  );

  app.patch(
    "/stores/:storeId/members/:memberId",
    {
      preHandler: guard,
      schema: {
        tags: ["team"],
        summary: "Cambiar el rol de un miembro",
        params: memberParams,
        body: z.object({ roleId: z.uuid() }),
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await team.changeMemberRole({
        storeId: request.params.storeId,
        memberId: request.params.memberId,
        roleId: request.body.roleId,
        actorUserId: currentAuth(request).user.id,
      });
      return reply.code(204).send(null);
    },
  );

  app.delete(
    "/stores/:storeId/members/:memberId",
    {
      preHandler: guard,
      schema: {
        tags: ["team"],
        summary: "Quitar un miembro de la tienda",
        params: memberParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await team.removeMember({
        storeId: request.params.storeId,
        memberId: request.params.memberId,
        actorUserId: currentAuth(request).user.id,
      });
      return reply.code(204).send(null);
    },
  );

  app.get(
    "/stores/:storeId/roles",
    {
      preHandler: guard,
      schema: {
        tags: ["team"],
        summary: "Roles de la tienda",
        params: uuidParam,
        response: { 200: z.object({ roles: z.array(roleSchema) }) },
      },
    },
    async (request) => ({ roles: await team.listRoles(request.params.storeId) }),
  );

  app.post(
    "/stores/:storeId/roles",
    {
      preHandler: guard,
      schema: {
        tags: ["team"],
        summary: "Crear un rol con permisos a medida",
        params: uuidParam,
        body: z.object({
          name: z.string().trim().min(1).max(60),
          permissions: z.array(permissionSchema).min(1),
        }),
        response: { 201: roleSchema },
      },
    },
    async (request, reply) => {
      const role = await team.createRole({
        storeId: request.params.storeId,
        actorUserId: currentAuth(request).user.id,
        name: request.body.name,
        permissions: request.body.permissions,
      });
      return reply.code(201).send(role);
    },
  );

  app.patch(
    "/stores/:storeId/roles/:roleId",
    {
      preHandler: guard,
      schema: {
        tags: ["team"],
        summary: "Editar un rol",
        params: roleParams,
        body: z
          .object({
            name: z.string().trim().min(1).max(60),
            permissions: z.array(permissionSchema).min(1),
          })
          .partial(),
        response: { 200: roleSchema },
      },
    },
    (request) =>
      team.updateRole({
        storeId: request.params.storeId,
        roleId: request.params.roleId,
        actorUserId: currentAuth(request).user.id,
        ...request.body,
      }),
  );

  app.delete(
    "/stores/:storeId/roles/:roleId",
    {
      preHandler: guard,
      schema: {
        tags: ["team"],
        summary: "Eliminar un rol sin miembros asignados",
        params: roleParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await team.deleteRole({
        storeId: request.params.storeId,
        roleId: request.params.roleId,
        actorUserId: currentAuth(request).user.id,
      });
      return reply.code(204).send(null);
    },
  );

  done();
};
