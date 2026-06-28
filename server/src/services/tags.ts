import { prisma } from "./prisma";
import { requireWorkspaceMember } from "./authorization";

/** Client-safe tag view. */
export interface SafeTag {
  id: string;
  name: string;
}

/** Normalizes a tag's display name into its canonical storage form. */
function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

/** Lists every tag in a workspace, alphabetically (for filter/autocomplete UI). Any member may view. */
export async function listTags(workspaceId: string, userId: string): Promise<SafeTag[]> {
  await requireWorkspaceMember(workspaceId, userId);
  const tags = await prisma.tag.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
  return tags.map((t) => ({ id: t.id, name: t.name }));
}

/**
 * Replaces a workflow's full tag set with `names` (workspace-scoped, normalized,
 * deduplicated, created on demand). After detaching tags, any tag left with zero
 * workflows is pruned so the filter list never accumulates dead entries.
 *
 * Returns the workflow's resulting tags. Caller is responsible for any RBAC
 * check on the workflow itself; this only touches Tag/WorkflowTag rows.
 */
export async function syncWorkflowTags(workspaceId: string, workflowId: string, names: string[]): Promise<SafeTag[]> {
  const normalized = [...new Set(names.map(normalizeTagName).filter((n) => n.length > 0))];

  const tags = await Promise.all(
    normalized.map((name) =>
      prisma.tag.upsert({
        where: { workspaceId_name: { workspaceId, name } },
        create: { workspaceId, name },
        update: {},
      }),
    ),
  );

  const current = await prisma.workflowTag.findMany({ where: { workflowId }, select: { tagId: true } });
  const currentIds = new Set(current.map((t) => t.tagId));
  const desiredIds = new Set(tags.map((t) => t.id));

  const toAdd = tags.filter((t) => !currentIds.has(t.id));
  const toRemoveIds = [...currentIds].filter((id) => !desiredIds.has(id));

  await prisma.$transaction([
    ...(toRemoveIds.length
      ? [prisma.workflowTag.deleteMany({ where: { workflowId, tagId: { in: toRemoveIds } } })]
      : []),
    ...(toAdd.length
      ? [prisma.workflowTag.createMany({ data: toAdd.map((t) => ({ workflowId, tagId: t.id })) })]
      : []),
  ]);

  // Tidiness: a tag no longer attached to anything is dead weight in the filter list.
  if (toRemoveIds.length) {
    await prisma.tag.deleteMany({ where: { id: { in: toRemoveIds }, workspaceId, workflows: { none: {} } } });
  }

  return tags.map((t) => ({ id: t.id, name: t.name }));
}
