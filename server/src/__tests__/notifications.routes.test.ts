import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { prisma } from "../services/prisma";
import { setNotificationPublisher } from "../realtime/notifications";

// Notifications are persisted in the API path; live delivery is best-effort, so
// keep the publisher a no-op here (its socket behaviour is covered separately).
vi.mock("../scheduler/sync", () => ({
  syncWorkflowSchedule: vi.fn(async () => {}),
  removeWorkflowSchedules: vi.fn(async () => {}),
}));

const app = createApp();

beforeEach(async () => {
  await prisma.notification.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

function auth(token: string): [string, string] {
  return ["Authorization", `Bearer ${token}`];
}

interface Registered {
  token: string;
  userId: string;
  email: string;
  workspaceId: string;
}

let emailSeq = 0;
async function registerUser(name: string): Promise<Registered> {
  emailSeq += 1;
  const email = `notif${emailSeq}@example.com`;
  const res = await request(app).post("/auth/register").send({ name, email, password: "Password123!" });
  return { token: res.body.token, userId: res.body.user.id, email, workspaceId: res.body.workspace.id };
}

function invite(token: string, workspaceId: string, email: string, role: string) {
  return request(app).post(`/workspaces/${workspaceId}/invites`).set(...auth(token)).send({ email, role });
}

/** Accept the latest pending invite for a user; returns their userId. */
async function join(ownerToken: string, workspaceId: string, user: Registered, role: string) {
  await invite(ownerToken, workspaceId, user.email, role);
  const inviteId = (await request(app).get("/invites").set(...auth(user.token))).body[0].id;
  await request(app).post(`/invites/${inviteId}/accept`).set(...auth(user.token));
}

describe("notifications: creation", () => {
  it("notifies an existing user when they are invited to a workspace", async () => {
    const owner = await registerUser("Owner");
    const invitee = await registerUser("Invitee");

    await invite(owner.token, owner.workspaceId, invitee.email, "editor");

    const res = await request(app).get("/notifications").set(...auth(invitee.token));
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(1);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0]).toMatchObject({ type: "workspace.invited", read: false });
    expect(res.body.notifications[0].title).toContain("invited");
  });

  it("notifies a member when their role changes (but not when they change their own)", async () => {
    const owner = await registerUser("Owner");
    const member = await registerUser("Member");
    await join(owner.token, owner.workspaceId, member, "viewer");

    // Clear the invite notification so we assert only on the role-change one.
    await prisma.notification.deleteMany({ where: { userId: member.userId } });

    await request(app)
      .patch(`/workspaces/${owner.workspaceId}/members/${member.userId}`)
      .set(...auth(owner.token))
      .send({ role: "editor" });

    const res = await request(app).get("/notifications").set(...auth(member.token));
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0]).toMatchObject({ type: "role.changed" });
    expect(res.body.notifications[0].body).toContain("editor");

    // The owner, who initiated the change, gets nothing about themselves.
    const ownerNotifs = await request(app).get("/notifications").set(...auth(owner.token));
    expect(ownerNotifs.body.notifications).toHaveLength(0);
  });

  it("publishes over the notification bus when a notification is created", async () => {
    const published: { userId: string; event: string }[] = [];
    setNotificationPublisher((userId, event) => published.push({ userId, event }));

    try {
      const owner = await registerUser("Owner");
      const invitee = await registerUser("Invitee");
      await invite(owner.token, owner.workspaceId, invitee.email, "viewer");

      // A new item + an unread-count refresh, both addressed to the invitee.
      expect(published.some((p) => p.userId === invitee.userId && p.event === "notification:new")).toBe(true);
      expect(published.some((p) => p.userId === invitee.userId && p.event === "notification:unread")).toBe(true);
    } finally {
      setNotificationPublisher(() => {});
    }
  });
});

describe("notifications: read state", () => {
  /** Registers a user and gives them two unread notifications via invites. */
  async function withTwoNotifications() {
    const owner = await registerUser("Owner");
    const ws2 = await request(app).post("/workspaces").set(...auth(owner.token)).send({ name: "Second" });
    const user = await registerUser("User");
    await invite(owner.token, owner.workspaceId, user.email, "viewer");
    await invite(owner.token, ws2.body.id, user.email, "viewer");
    return user;
  }

  it("marks a single notification read and decrements the unread count", async () => {
    const user = await withTwoNotifications();

    const before = await request(app).get("/notifications").set(...auth(user.token));
    expect(before.body.unreadCount).toBe(2);
    const first = before.body.notifications[0].id;

    const read = await request(app).post(`/notifications/${first}/read`).set(...auth(user.token));
    expect(read.status).toBe(200);
    expect(read.body.read).toBe(true);

    const count = await request(app).get("/notifications/unread-count").set(...auth(user.token));
    expect(count.body.count).toBe(1);
  });

  it("marks all notifications read", async () => {
    const user = await withTwoNotifications();

    const res = await request(app).post("/notifications/read-all").set(...auth(user.token));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);

    const count = await request(app).get("/notifications/unread-count").set(...auth(user.token));
    expect(count.body.count).toBe(0);

    // The unread-only filter now returns nothing.
    const unread = await request(app).get("/notifications").query({ unread: "true" }).set(...auth(user.token));
    expect(unread.body.notifications).toHaveLength(0);
  });

  it("forbids reading a notification that belongs to someone else", async () => {
    const user = await withTwoNotifications();
    const other = await registerUser("Other");
    const someId = (await request(app).get("/notifications").set(...auth(user.token))).body.notifications[0].id;

    const res = await request(app).post(`/notifications/${someId}/read`).set(...auth(other.token));
    expect(res.status).toBe(404);
  });
});

afterEach(() => {
  setNotificationPublisher(() => {});
});
