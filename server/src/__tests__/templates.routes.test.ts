import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";
import { TEMPLATES } from "../templates/catalog";

// Instantiating a template creates a workflow, which reconciles cron schedules
// on save; these tests only create (no schedule node activation), but stub the
// scheduler anyway so they need Postgres only, not Redis.
vi.mock("../scheduler/sync", () => ({
  syncWorkflowSchedule: vi.fn(async () => {}),
  removeWorkflowSchedules: vi.fn(async () => {}),
}));

const app = createApp();

beforeEach(async () => {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

interface Registered {
  token: string;
  userId: string;
  workspaceId: string;
}

async function registerUser(name: string, email: string): Promise<Registered> {
  const res = await request(app).post("/auth/register").send({ name, email, password: "Password123!" });
  return { token: res.body.token, userId: res.body.user.id, workspaceId: res.body.workspace.id };
}

function authHeader(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

describe("GET /templates", () => {
  it("returns the gallery with node types derived from each definition", async () => {
    const owner = await registerUser("Ada Lovelace", "tpl-ada@example.com");

    const res = await request(app).get("/templates").set(...authHeader(owner.token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(TEMPLATES.length);
    const first = res.body[0];
    expect(first).toMatchObject({ id: expect.any(String), name: expect.any(String), description: expect.any(String) });
    expect(Array.isArray(first.nodeTypes)).toBe(true);
    expect(first.nodeTypes.length).toBeGreaterThan(0);
    expect(first.definition.nodes.length).toBeGreaterThan(0);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/templates");
    expect(res.status).toBe(401);
  });
});

describe("POST /templates/:id/instantiate", () => {
  it("creates a new workflow pre-populated from the template definition", async () => {
    const owner = await registerUser("Ada Lovelace", "tpl-ada2@example.com");
    const template = TEMPLATES[0];

    const res = await request(app)
      .post(`/templates/${template.id}/instantiate`)
      .set(...authHeader(owner.token))
      .send({ workspaceId: owner.workspaceId });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      workspaceId: owner.workspaceId,
      name: template.name,
      description: template.description,
      isActive: true,
    });
    // The full template graph is persisted, with a webhook token ready to go.
    expect(res.body.definition).toEqual(template.definition);
    expect(res.body.webhookToken).toEqual(expect.any(String));

    // And it is a real, independently-listable workflow.
    const list = await request(app)
      .get("/workflows")
      .query({ workspaceId: owner.workspaceId })
      .set(...authHeader(owner.token));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(res.body.id);
  });

  it("honours a custom name override", async () => {
    const owner = await registerUser("Ada Lovelace", "tpl-ada3@example.com");

    const res = await request(app)
      .post(`/templates/${TEMPLATES[0].id}/instantiate`)
      .set(...authHeader(owner.token))
      .send({ workspaceId: owner.workspaceId, name: "My customized flow" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My customized flow");
  });

  it("produces a definition that passes workflow validation on save", async () => {
    const owner = await registerUser("Ada Lovelace", "tpl-ada4@example.com");

    const created = await request(app)
      .post(`/templates/${TEMPLATES[0].id}/instantiate`)
      .set(...authHeader(owner.token))
      .send({ workspaceId: owner.workspaceId });

    // Re-saving the instantiated definition must be accepted (no errors/warnings).
    const saved = await request(app)
      .put(`/workflows/${created.body.id}`)
      .set(...authHeader(owner.token))
      .send({ definition: created.body.definition });

    expect(saved.status).toBe(200);
    expect(saved.body.warnings).toEqual([]);
  });

  it("returns 404 for an unknown template id", async () => {
    const owner = await registerUser("Ada Lovelace", "tpl-ada5@example.com");

    const res = await request(app)
      .post("/templates/does-not-exist/instantiate")
      .set(...authHeader(owner.token))
      .send({ workspaceId: owner.workspaceId });

    expect(res.status).toBe(404);
  });

  it("rejects a user who is not a member of the target workspace", async () => {
    const owner = await registerUser("Ada Lovelace", "tpl-ada6@example.com");
    const outsider = await registerUser("Eve", "tpl-eve@example.com");

    const res = await request(app)
      .post(`/templates/${TEMPLATES[0].id}/instantiate`)
      .set(...authHeader(outsider.token))
      .send({ workspaceId: owner.workspaceId });

    expect(res.status).toBe(403);
  });

  it("rejects a missing workspaceId", async () => {
    const owner = await registerUser("Ada Lovelace", "tpl-ada7@example.com");

    const res = await request(app)
      .post(`/templates/${TEMPLATES[0].id}/instantiate`)
      .set(...authHeader(owner.token))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
