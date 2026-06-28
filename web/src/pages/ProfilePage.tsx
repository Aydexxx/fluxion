import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "../store/auth";
import { authApi, errorMessage } from "../lib/api";
import type { DefaultLanding, WorkspaceRole } from "../lib/types";
import { navigate } from "../lib/router";
import { roleLabel } from "../lib/permissions";
import { useToast } from "../components/ui/toast";
import { confirm } from "../components/ui/confirm";
import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Label, Select, TextInput } from "../components/Field";
import { AvatarUploadDialog } from "../components/AvatarUploadDialog";
import { ChevronRightIcon, Logo } from "../components/icons";

const ROLE_COLOR: Record<WorkspaceRole, string> = {
  owner: "#e0a33e",
  admin: "#b98aff",
  editor: "#5b8cff",
  viewer: "#8d8d99",
};

const LANDING_OPTIONS: { value: DefaultLanding; label: string }[] = [
  { value: "workflows", label: "Workflows" },
  { value: "templates", label: "Templates" },
  { value: "runs", label: "Runs" },
  { value: "analytics", label: "Analytics" },
];

export function ProfilePage() {
  const reduce = useReducedMotion();
  const user = useAuth((s) => s.user);
  const workspaces = useAuth((s) => s.workspaces);

  if (!user) return null;

  return (
    <div className="relative h-screen overflow-y-auto bg-base">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[320px] bloom opacity-70" />

      <header className="sticky top-0 z-30 border-b border-white/8 bg-base/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted transition-colors hover:bg-white/5 hover:text-ink"
            aria-label="Back to app"
          >
            <Logo className="text-[17px] text-accent" />
            <ChevronRightIcon className="text-[15px] text-faint" />
          </button>
          <h1 className="font-display text-[15px] font-semibold tracking-tight">Profile</h1>
        </div>
      </header>

      <motion.main
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="relative mx-auto max-w-3xl space-y-5 px-6 pb-24 pt-8"
      >
        <AvatarCard />
        <AccountCard />
        <PasswordCard />
        <PreferencesCard />

        <Card title="Your workspaces" description="Where you're a member, and your role in each.">
          <ul className="space-y-1.5">
            {workspaces.map((ws) => (
              <li
                key={ws.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2"
              >
                <span className="truncate text-[13px] text-ink">{ws.name}</span>
                <Badge color={ROLE_COLOR[ws.role]} dot={false}>
                  {roleLabel(ws.role)}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </motion.main>
    </div>
  );
}

/** A titled section card. */
function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-white/8 bg-surface/50 p-5">
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-[12.5px] text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function AvatarCard() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const remove = async () => {
    if (!user?.avatarUrl) return;
    const ok = await confirm({ title: "Remove avatar?", body: "Your avatar will revert to your initials.", confirmLabel: "Remove", destructive: true });
    if (!ok) return;
    setRemoving(true);
    try {
      setUser(await authApi.removeAvatar());
      toast.success("Avatar removed");
    } catch (err) {
      toast.error(errorMessage(err, "Could not remove avatar"));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Card title="Avatar" description="Shown in the top bar, presence, members, and the audit log.">
      <div className="flex items-center gap-4">
        <Avatar name={user?.name} email={user?.email} avatarUrl={user?.avatarUrl} size={72} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setUploadOpen(true)}>
            Upload new
          </Button>
          {user?.avatarUrl ? (
            <Button variant="secondary" onClick={() => void remove()} loading={removing}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <AvatarUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onUploaded={setUser} />
    </Card>
  );
}

function AccountCard() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = name.trim() !== (user?.name ?? "") && name.trim().length > 0;

  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      setUser(await authApi.updateProfile({ name: name.trim() }));
      toast.success("Profile updated");
    } catch (err) {
      toast.error(errorMessage(err, "Could not update profile"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Account" description="Your display name and email.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="profile-name">Display name</Label>
          <TextInput id="profile-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
        </div>
        <div>
          <Label htmlFor="profile-email">Email</Label>
          <TextInput id="profile-email" value={user?.email ?? ""} readOnly disabled aria-readonly className="opacity-70" />
          <p className="mt-1.5 text-[11.5px] text-faint">Email is used to sign in and can't be changed here.</p>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving] = useState(false);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirmPw.length > 0 && next !== confirmPw;
  const valid = current.length > 0 && next.length >= 8 && next === confirmPw;

  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await authApi.changePassword(current, next);
      toast.success("Password changed");
      setCurrent("");
      setNext("");
      setConfirmPw("");
    } catch (err) {
      toast.error(errorMessage(err, "Could not change password"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Password" description="Use a strong password you don't use elsewhere.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="pw-current">Current password</Label>
          <TextInput id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="pw-new">New password</Label>
          <TextInput id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          {tooShort ? <p className="mt-1.5 text-[11.5px] text-danger">Must be at least 8 characters.</p> : null}
        </div>
        <div>
          <Label htmlFor="pw-confirm">Confirm new password</Label>
          <TextInput id="pw-confirm" type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} />
          {mismatch ? <p className="mt-1.5 text-[11.5px] text-danger">Passwords don't match.</p> : null}
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void submit()} loading={saving} disabled={!valid}>
            Change password
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PreferencesCard() {
  const toast = useToast();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [landing, setLanding] = useState<DefaultLanding>(user?.preferences.defaultLanding ?? "workflows");
  const [saving, setSaving] = useState(false);

  const change = async (value: DefaultLanding) => {
    setLanding(value);
    setSaving(true);
    try {
      setUser(await authApi.updateProfile({ preferences: { defaultLanding: value } }));
      toast.success("Preferences saved");
    } catch (err) {
      toast.error(errorMessage(err, "Could not save preferences"));
      setLanding(user?.preferences.defaultLanding ?? "workflows");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="Preferences" description="Tune how the app behaves for you.">
      <div className="space-y-4">
        <div>
          <Label htmlFor="pref-landing">Default landing section</Label>
          <Select
            id="pref-landing"
            value={landing}
            disabled={saving}
            onChange={(e) => void change(e.target.value as DefaultLanding)}
          >
            {LANDING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-[11.5px] text-faint">Where you land right after signing in.</p>
        </div>
        <div>
          <Label htmlFor="pref-theme">Theme</Label>
          <Select id="pref-theme" value="dark" disabled aria-readonly>
            <option value="dark">Dark</option>
          </Select>
          <p className="mt-1.5 text-[11.5px] text-faint">Fluxion currently ships a single, dark theme.</p>
        </div>
      </div>
    </Card>
  );
}
