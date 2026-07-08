import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { CheckCircle2, XCircle } from "lucide-react";
import type { HealthSnapshot } from "@open-superforecaster/workflow-contracts";

type HealthRow = {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
};

const columns: Array<ColumnDef<HealthRow>> = [
  {
    accessorKey: "ok",
    header: "State",
    cell: ({ row }) =>
      row.original.ok ? (
        <span className="status good"><CheckCircle2 size={16} /> Ready</span>
      ) : (
        <span className="status bad"><XCircle size={16} /> Attention</span>
      ),
  },
  {
    accessorKey: "label",
    header: "Check",
  },
  {
    accessorKey: "detail",
    header: "Detail",
    cell: ({ getValue }) => {
      const detail = String(getValue() ?? "");
      return (
        <code className="detail-code" title={detail}>
          {truncate(detail)}
        </code>
      );
    },
  },
];

export function SystemHealthTable({ health }: { health: HealthSnapshot }) {
  const rows = Object.entries(health.checks).map(([key, check]) => ({
    key,
    ...check,
  }));

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <table className="data-table">
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <th key={header.id}>
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.original.key}>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function truncate(value: string) {
  return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}
