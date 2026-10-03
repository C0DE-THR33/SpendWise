import { getCurrentUser } from "@/lib/auth";
import { getBillScansData } from "@/lib/queries";
import { formatCurrency } from "@/lib/utils";
import { formatShortDate } from "@/lib/dates";
import { DetailHeader } from "@/components/ui/PageHeader";

// The scan list here is real (getBillScansData). The camera/upload flow
// that would create a BillScan and run it through the Claude API for
// receipt extraction isn't wired up in this pass — that needs an
// ANTHROPIC_API_KEY and an upload target, neither of which exist yet.
// Shown honestly as a disabled state rather than faked.
export default async function BillScannerPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const scans = await getBillScansData(user.id);

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <DetailHeader title="Bill scanner" backHref="/more" />

      <button
        disabled
        className="mb-6 w-full rounded-card border-2 border-dashed border-border py-10 text-center text-sm font-medium text-fg-muted"
        title="Set ANTHROPIC_API_KEY to enable receipt scanning"
      >
        <span className="inline-flex items-center gap-2"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5h3l1.4-2.2c.3-.5.8-.8 1.4-.8h5.4c.6 0 1.1.3 1.4.8l1.4 2.2h3v10h-17v-10Z" /><circle cx="12" cy="13" r="3.2" /></svg> Scan a receipt</span>
        <span className="mt-1 block text-xs font-normal">Coming soon — needs a Claude API key</span>
      </button>

      {scans.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-6 text-center text-sm text-fg-muted">
          No scanned receipts yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-card bg-surface shadow-card">
          {scans.map((scan, i) => (
            <div key={scan.id} className={`flex items-center justify-between px-4 py-3.5 ${i > 0 ? "border-t border-border" : ""}`}>
              <div>
                <p className="text-sm font-medium text-fg">{scan.merchantName ?? "Processing…"}</p>
                <p className="text-xs text-fg-muted">
                  {scan.scanDate ? formatShortDate(scan.scanDate) : scan.status.toLowerCase()}
                </p>
              </div>
              {scan.amount ? (
                <span className="text-sm font-medium text-fg">{formatCurrency(scan.amount)}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
