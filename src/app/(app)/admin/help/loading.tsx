import { TableSkeleton } from "@/components/admin/table-skeleton";

export default function Loading() {
  return <TableSkeleton rows={6} actions={false} />;
}
