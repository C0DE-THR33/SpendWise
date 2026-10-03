import { getCurrentUser } from "@/lib/auth";
import { getSettingsData } from "@/lib/queries";
import { formatShortDate } from "@/lib/dates";
import { DetailHeader } from "@/components/ui/PageHeader";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { linkedAccounts } = await getSettingsData(user.id);

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <DetailHeader title="Settings" backHref="/more" />

      <section className="mb-6 rounded-card bg-surface shadow-card p-5">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Account</p>
        <p className="text-sm text-fg">{user.email}</p>
      </section>

      <section>
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-muted">Linked accounts</p>
        {linkedAccounts.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-fg-muted">
            No bank accounts connected yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-card bg-surface shadow-card">
            {linkedAccounts.map((account, i) => (
              <div key={account.id} className={`flex items-center justify-between px-4 py-3.5 ${i > 0 ? "border-t border-border" : ""}`}>
                <div>
                  <p className="text-sm font-medium text-fg">{account.fipName}</p>
                  <p className="text-xs text-fg-muted">
                    •••• {account.maskedAccountNumber.slice(-4)} · {account.accountType.replace("_", " ").toLowerCase()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-medium text-fg">{account.consentStatus.toLowerCase()}</p>
                  {account.lastSyncedAt ? (
                    <p className="text-[11px] text-fg-muted">synced {formatShortDate(account.lastSyncedAt)}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
