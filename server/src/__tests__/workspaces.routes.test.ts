import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";

const app = createApp();

beforeEach(async () => {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

function authHeader(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

describe("GET /workspaces", () => {
  it("returns 401 without a token", async () => {
    const res = await request(app).get("/workspaces");
    expect(res.status).toBe(401);
  });

  it("lists the workspaces the user belongs to, including their default workspace", async () => {
    const register = await request(app)
      .post("/auth/register")
      .send({ name: "Ada Lovelace", email: "ada@example.com", password: "Password123!" });
    const { token } = register.body;
    const defaultWorkspaceId = register.body.workspace.id;

    const res = await request(app).get("/workspaces").set(...authHeader(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: defaultWorkspaceId, name: "Ada Lovelace's Workspace" });
  });

  it("does not list workspaces the user is not a member of", async () => {
    const ada = await request(app)
      .post("/auth/register")
      .send({ name: "Ada", email: "ada2@example.com", password: "Password123!" });
    await request(app)
      .post("/auth/register")
      .send({ name: "Eve", email: "eve@example.com", password: "Password123!" });

    const res = await request(app).get("/workspaces").set(...authHeader(ada.body.token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(ada.body.workspace.id);
  });
});
