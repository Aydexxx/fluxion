import { useState } from "react";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "../components/ui/Dialog";
import { FieldShell, Select, TextInput } from "../components/Field";
import { AlertIcon } from "../components/icons";
import { useEditor } from "./editorStore";
import { useToast } from "../components/ui/toast";

type Channel = "off" | "slack" | "email";

/**
 * Configures the workflow-level failure alert: when a run dead-letters, notify a
 * Slack/Discord webhook or an email address. Reuses the same credentials the
 * Slack/email nodes use. The form lives in {@link AlertForm}, mounted only while
 * open so it seeds from the saved config without an effect.
 */
export function FailureAlertDialog() {
  const open = useEditor((s) => s.failureAlertOpen);
  const setOpen = useEditor((s) => s.setFailureAlertOpen);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} size="sm" aria-label="Failure alert">
      <AlertForm onClose={() => setOpen(false)} />
    </Dialog>
  );
}

function AlertForm({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const failureNotify = useEditor((s) => s.failureNotify);
  const credentials = useEditor((s) => s.credentials);
  const openCredentials = useEditor((s) => s.setCredentialsManagerOpen);
  const save = useEditor((s) => s.saveFailureNotify);

  // Seeded once at mount (the dialog only renders this while open).
  const [channel, setChannel] = useState<Channel>(failureNotify?.channel ?? "off");
  const [credentialId, setCredentialId] = useState(failureNotify?.credentialId ?? "");
  const [to, setTo] = useState(failureNotify?.to ?? "");
  const [saving, setSaving] = useState(false);

  const credType = channel === "email" ? "smtp" : "slack_webhook";
  const options = credentials.filter((c) => c.type === credType);

  const handleSave = async () => {
    const config =
      channel === "off" ? null : { channel, credentialId, ...(channel === "email" ? { to: to.trim() } : {}) };

    if (config && config.credentialId === "") {
      toast.error("Select a credential to send through");
      return;
    }
    if (config && channel === "email" && (!config.to || config.to === "")) {
      toast.error("Enter a recipient email address");
      return;
    }

    setSaving(true);
    const res = await save(config);
    if (res.ok) toast.success(config ? "Failure alert saved" : "Failure alert turned off");
    else toast.error(res.message ?? "Could not save");
    setSaving(false);
  };

  return (
    <>
      <DialogHeader title="Failure alert" description="Notify a channel when a run fails" icon={<AlertIcon />} />
      <DialogBody className="space-y-4">
        <FieldShell label="When a run fails" hint="Fires once a run has failed after exhausting its retries.">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            <option value="off">Don’t notify</option>
            <option value="slack">Post to Slack / Discord</option>
            <option value="email">Send an email</option>
          </Select>
        </FieldShell>

        {channel !== "off" ? (
          <FieldShell
            label="Credential"
            hint={channel === "email" ? "An SMTP credential to send through." : "A Slack/Discord webhook credential."}
          >
            <div className="flex items-center gap-2">
              <Select value={credentialId} onChange={(e) => setCredentialId(e.target.value)}>
                <option value="">Select a credential…</option>
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.last4 ? ` ••••${c.last4}` : ""}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => openCredentials(true)}
                className="shrink-0 rounded-lg border border-white/8 px-2.5 py-2 text-[12px] text-muted transition-colors hover:border-white/14 hover:text-ink"
              >
                Manage
              </button>
            </div>
            {options.length === 0 ? (
              <p className="mt-1.5 text-[11.5px] text-faint">No matching credentials yet — add one with “Manage”.</p>
            ) : null}
          </FieldShell>
        ) : null}

        {channel === "email" ? (
          <FieldShell label="Send to">
            <TextInput placeholder="on-call@example.com" value={to} onChange={(e) => setTo(e.target.value)} />
          </FieldShell>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-white/10 px-3.5 py-2 text-[13px] font-medium text-muted transition-colors hover:text-ink"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg px-4 py-2 text-[13px] font-semibold text-white transition-all disabled:opacity-70"
          style={{ background: "linear-gradient(180deg, var(--color-accent-bright), var(--color-accent-deep))" }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </DialogFooter>
    </>
  );
}
