import { useState } from 'react';

import {
  useDailyReport,
  useMonthlyReport,
  useByProductReport,
} from '../../features/admin/useAdmin.js';

type Tab = 'daily' | 'monthly' | 'byProduct';

export function AdminReportsPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('daily');

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">銷售報表</h1>

      {/* Tab bar */}
      <div className="mb-6 flex gap-2 border-b border-line">
        {(
          [
            ['daily', '每日'],
            ['monthly', '每月'],
            ['byProduct', '商品'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-ink text-ink'
                : 'border-transparent text-ink-soft hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'daily' && <DailyTab />}
      {tab === 'monthly' && <MonthlyTab />}
      {tab === 'byProduct' && <ByProductTab />}
    </div>
  );
}

function DailyTab() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useDailyReport(days);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium">天數</label>
        {[7, 14, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            className={`rounded-full px-3 py-1 text-sm border ${
              days === d ? 'bg-ink text-white border-ink' : 'border-line hover:bg-paper-2'
            }`}
          >
            {d} 天
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-ink-soft">載入中…</p>
      ) : (
        <ReportTable
          headers={['日期', '訂單數', '營收']}
          rows={
            data?.rows.map((r) => [
              r.date,
              String(r.orderCount),
              `NT$${Number(r.revenue).toLocaleString()}`,
            ]) ?? []
          }
        />
      )}
    </div>
  );
}

function MonthlyTab() {
  const [months, setMonths] = useState(12);
  const { data, isLoading } = useMonthlyReport(months);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium">月數</label>
        {[3, 6, 12, 24].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMonths(m)}
            className={`rounded-full px-3 py-1 text-sm border ${
              months === m ? 'bg-ink text-white border-ink' : 'border-line hover:bg-paper-2'
            }`}
          >
            {m} 個月
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-ink-soft">載入中…</p>
      ) : (
        <ReportTable
          headers={['月份', '訂單數', '營收']}
          rows={
            data?.rows.map((r) => [
              r.month,
              String(r.orderCount),
              `NT$${Number(r.revenue).toLocaleString()}`,
            ]) ?? []
          }
        />
      )}
    </div>
  );
}

function ByProductTab() {
  const { data, isLoading } = useByProductReport();

  return (
    <div>
      {isLoading ? (
        <p className="text-ink-soft">載入中…</p>
      ) : (
        <ReportTable
          headers={['商品名稱', '銷售數量', '銷售金額']}
          rows={
            data?.rows.map((r) => [
              r.productName,
              String(r.totalQty),
              `NT$${Number(r.revenue).toLocaleString()}`,
            ]) ?? []
          }
        />
      )}
    </div>
  );
}

function ReportTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  if (rows.length === 0) {
    return <p className="text-center py-8 text-ink-soft">此期間無資料</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 text-left font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row[0]} className="hover:bg-paper-2">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-3">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
