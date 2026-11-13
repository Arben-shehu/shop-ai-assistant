import type { LucideIcon } from "lucide-react";
import type { OrderStatus } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "Në pritje",
  CONFIRMED: "Konfirmuar",
  PREPARING: "Në përgatitje",
  DELIVERED: "Dorëzuar",
  CANCELLED: "Anuluar",
};
export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABEL) as OrderStatus[];

const STATUS_VARIANT: Record<OrderStatus, "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "secondary",
  CONFIRMED: "outline",
  PREPARING: "outline",
  DELIVERED: "default",
  CANCELLED: "destructive",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{ORDER_STATUS_LABEL[status]}</Badge>;
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description?: string }) {
  return (
    <Empty className="border py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}
