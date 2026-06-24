import type { NodeExecutor, SmtpConfig } from "../types";
import { resolveCredential } from "./credentialUtil";

interface EmailConfig {
  credentialId?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
  from?: string;
}

/**
 * Sends an email through SMTP. Connection details (host, auth, default sender)
 * come from an `smtp` credential, decrypted at execution time; the message
 * fields come from the (template-resolved) node config. The actual transport is
 * injected via `context.email` — the worker supplies a real nodemailer sender,
 * tests supply a stub — so this executor stays I/O-agnostic and offline-testable.
 */
export const emailExecutor: NodeExecutor = {
  type: "action.email",
  async execute(node, _input, context) {
    const config = node.config as EmailConfig;
    if (!context.email) throw new Error("Email transport is not configured for this run");

    const to = (config.to ?? "").trim();
    if (!to) throw new Error("email node requires a 'to' address");

    const { data } = await resolveCredential(context, config.credentialId, "smtp");
    if (!data.host) throw new Error("smtp credential is missing its host");

    const smtp: SmtpConfig = {
      host: data.host,
      port: data.port ? Number(data.port) : 587,
      username: data.username,
      password: data.password,
      from: data.from,
      secure: data.secure === "true",
    };

    return context.email.send(smtp, {
      to,
      subject: config.subject ?? "",
      text: typeof config.text === "string" ? config.text : undefined,
      html: typeof config.html === "string" && config.html !== "" ? config.html : undefined,
      from: config.from?.trim() || undefined,
    });
  },
};
