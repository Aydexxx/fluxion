-- Multi-user workspaces: formalize roles (owner/admin/editor/viewer) and add invites.

-- 1. Rebuild the WorkspaceRole enum, migrating the legacy `member` role to `editor`
--    (members could create/edit before, which is the editor tier now).
ALTER TYPE "WorkspaceRole" RENAME TO "WorkspaceRole_old";

CREATE TYPE "WorkspaceRole" AS ENUM ('owner', 'admin', 'editor', 'viewer');

ALTER TABLE "WorkspaceMember" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "WorkspaceMember"
  ALTER COLUMN "role" TYPE "WorkspaceRole"
  USING (
    CASE "role"::text
      WHEN 'member' THEN 'editor'
      ELSE "role"::text
    END
  )::"WorkspaceRole";

ALTER TABLE "WorkspaceMember" ALTER COLUMN "role" SET DEFAULT 'viewer';

DROP TYPE "WorkspaceRole_old";

-- 2. Invite status enum + Invite table.
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'declined');

CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'viewer',
    "status" "InviteStatus" NOT NULL DEFAULT 'pending',
    "invitedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Invite_workspaceId_email_key" ON "Invite"("workspaceId", "email");
CREATE INDEX "Invite_email_idx" ON "Invite"("email");
CREATE INDEX "Invite_workspaceId_idx" ON "Invite"("workspaceId");

ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
