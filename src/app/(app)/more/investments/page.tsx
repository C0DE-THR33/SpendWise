import { getCurrentUser } from "@/lib/auth";
import { getInvestmentsData } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";
import { DetailHeader } from "@/components/ui/PageHeader";

export default async function InvestmentsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const data = await getInvestmentsData(user.id);

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <DetailHeader title="Investments" backHref="/more" />

      <section className="mb-6 rounded-card bg-surface shadow-card p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Current value</p>
        <p className="mt-1 text-2xl font-semibold text-fg">{formatCurrency(data.totalCurrent)}</p>
        <p className={`mt-1 text-sm ${data.totalGain >= 0 ? "text-success-fg" : "text-danger-fg"}`}>
          {data.totalGain >= 0 ? "+" : ""}
          {formatCurrency(data.totalGain)} overall
        </p>
      </section>

      {data.investments.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-fg-muted">
          No investments added yet. This is a manually-maintained ledger — there&apos;s no live
          brokerage sync in v1.
        </p>
      ) : (
        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          {data.investments.map((inv, i) => {
            const gain = inv.currentValue - inv.investedAmount;
            return (
              <div key={inv.id} className={`flex items-center justify-between px-4 py-3.5 ${i > 0 ? "border-t border-border" : ""}`}>
                <div>
                  <p className="text-sm font-medium text-fg">{inv.name}</p>
                  <p className="text-xs text-fg-muted">{inv.type.replace("_", " ").toLowerCase()}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-fg">{formatCurrency(inv.currentValue)}</p>
                  <p className={`text-xs ${gain >= 0 ? "text-success-fg" : "text-danger-fg"}`}>
                    {gain >= 0 ? "+" : ""}
                    {formatCurrency(gain)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
