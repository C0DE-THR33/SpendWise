"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CategoryTile, DashedTile } from "./CategoryTile";
import { asCategoryIcon, asCategoryColor, type CategoryOption } from "@/lib/categories";

// The add-a-cash-transaction sheet, opened by the round button in the
// middle of the bottom bar (components/nav/BottomNav.tsx). Bank rows come
// from the AA sync; this is how cash — the spending a bank feed can never
// see — gets in.
//
// It used to live in AddCashButton.tsx together with the floating button
// Home rendered. The button moved into the nav so it is reachable from
// every tab; the sheet came here so nothing imports a file named after a
// button to get a sheet.
//
// The layout follows the reference's "Add Expenses" screen: the amount is
// the first and largest thing, the category is a row of tiles rather than a
// select, and everything else is secondary.
//
// Category stays optional on purpose. Leaving it blank runs the merchant
// rules server-side (lib/categorize.ts), so "Auto rickshaw" files itself
// under Transport without the user being made to choose. Picking one
// explicitly overrides that and records MANUAL.
export function AddCashSheet({
  categories,
  onClose,
}: {
  categories: CategoryOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountValue = Number(amount);
  const canSave =
    !saving && merchantName.trim().length > 0 && Number.isFinite(amountValue) && amountValue > 0;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          merchantName: merchantName.trim(),
          categoryId,
          direction: "DEBIT",
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not save that");
      }

      onClose();
      // Server Components hold this page's data, so a refresh is what makes
      // the new row, the donut and the budget bar agree with the database.
      router.refresh();
    } catch (caught) {
      // Catches the synchronous throws too, not just rejected fetches —
      // the login button's "stuck on Sending…" bug was exactly this shape.
      setError(caught instanceof Error ? caught.message : "Could not save that");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-end bg-black/45" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-[1.75rem] bg-surface px-5 pb-8 pt-3 shadow-float"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-pill bg-border" />

        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-fg">Add expense</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-9 items-center justify-center rounded-full bg-surface-sunken text-fg-muted"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        {/* The amount is the screen, as in the reference: one oversized
         * field on its own card, no label competing with it. */}
        <label htmlFor="cash-amount" className="sr-only">
          Amount
        </label>
        <div className="mb-5 flex items-baseline justify-center gap-1.5 rounded-card bg-surface-sunken px-4 py-6">
          <span className="text-3xl font-bold text-fg-faint">₹</span>
          <input
            id="cash-amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            autoFocus
            // No fixed width: field-sizing lets the box hug the digits so
            // the ₹ stays next to them, and the max-width caps the default
            // ~20ch input in browsers that don't support it yet. A
            // full-width centered input strands the ₹ at the card's edge.
            className="tnum min-w-[2ch] max-w-[9ch] bg-transparent text-left text-4xl font-bold tracking-tight text-fg outline-none field-sizing-content placeholder:text-fg-faint"
          />
        </div>

        <label className="mb-2 block text-[13px] font-semibold text-fg-muted" htmlFor="cash-merchant">
          Where
        </label>
        <input
          id="cash-merchant"
          type="text"
          value={merchantName}
          onChange={(event) => setMerchantName(event.target.value)}
          placeholder="Auto rickshaw, chai, groceries…"
          maxLength={120}
          className="mb-5 w-full rounded-tile border border-border bg-bg px-4 py-3.5 text-sm font-medium text-fg outline-none placeholder:text-fg-faint focus:border-accent"
        />

        <p className="mb-3 text-[13px] font-semibold text-fg-muted">
          Category <span className="font-normal text-fg-faint">— optional, we&apos;ll guess</span>
        </p>
        <div className="mb-6 grid grid-cols-4 gap-y-4">
          <button
            type="button"
            onClick={() => setCategoryId(null)}
            className="flex flex-col items-center gap-1.5"
          >
            <span
              className={
                categoryId === null
                  ? "inline-flex rounded-[0.95rem] ring-2 ring-accent ring-offset-2 ring-offset-surface"
                  : "inline-flex"
              }
            >
              <DashedTile size="md" label="question" />
            </span>
            <span className="max-w-[4.5rem] text-center text-[11px] font-medium leading-tight text-fg-muted">
              Auto
            </span>
          </button>

          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => setCategoryId(category.id)}
              className="flex flex-col items-center gap-1.5"
            >
              <CategoryTile
                icon={asCategoryIcon(category.icon)}
                color={asCategoryColor(category.color)}
                size="md"
                selected={categoryId === category.id}
              />
              {/* Wrapped to two lines rather than truncated: at four
                * columns "Food & Dining" and "Bills & Utilities" both clip
                * to a stub that no longer names the category. */}
              <span className="line-clamp-2 max-w-[4.5rem] text-center text-[11px] font-medium leading-tight text-fg-muted">
                {category.name}
              </span>
            </button>
          ))}
        </div>

        {error ? <p className="mb-3 text-sm font-medium text-danger-fg">{error}</p> : null}

        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="w-full rounded-pill bg-accent py-4 text-sm font-bold text-accent-fg shadow-float transition-transform active:scale-[0.99] disabled:opacity-50 disabled:shadow-none"
        >
          {saving ? "Saving…" : "Add expense"}
        </button>
      </div>
    </div>
  );
}
