import { getCurrentUser } from "@/lib/auth";
import { getTransactionsData } from "@/lib/queries";
import { TransactionsList } from "@/components/transactions/TransactionsList";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function TransactionsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const transactions = await getTransactionsData(user.id);

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <PageHeader title="Activity" initial={user.email.charAt(0)} />
      <TransactionsList transactions={transactions} />
    </div>
  );
}
