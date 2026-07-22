import { useEffect, useMemo, useState } from "react";
import { api, type Expense } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { formatVnd } from "../lib/utils";

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);

  useEffect(() => {
    api.trips()
      .then((ts) => (ts[0] ? api.expenses(ts[0].id) : []))
      .then(setExpenses)
      .catch(() => setExpenses([]));
  }, []);

  const total = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Chi phí chuyến đi</h1>
      <Card className="bg-primary text-primary-foreground">
        <CardHeader><CardTitle className="text-sm font-medium opacity-80">Tổng chi</CardTitle></CardHeader>
        <CardContent className="text-2xl font-bold">{formatVnd(total)}</CardContent>
      </Card>
      <div className="space-y-2">
        {expenses.map((e) => (
          <Card key={e.id}>
            <CardContent className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">{e.title}</p>
                <p className="text-xs text-muted-foreground">trả bởi {e.paidBy}</p>
              </div>
              <p className="font-semibold">{formatVnd(e.amount)}</p>
            </CardContent>
          </Card>
        ))}
        {expenses.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Hoá đơn Lisa ghi nhận từ nhóm chat sẽ hiện ở đây.
          </p>
        )}
      </div>
    </div>
  );
}
