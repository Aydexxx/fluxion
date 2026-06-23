import type { Request, Response } from "express";
import { currentUserId } from "../middleware/auth";
import { getRun } from "../services/runs";
import type { RunRecord } from "../engine/persistence";

export async function getRunById(req: Request<{ id: string }>, res: Response<RunRecord>): Promise<void> {
  const run = await getRun(req.params.id, currentUserId(req));
  res.json(run);
}
