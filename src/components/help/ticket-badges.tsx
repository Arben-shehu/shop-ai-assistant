import { Badge } from "@/components/ui/badge";

export const STATUS_LABELS = {
  OPEN: "E hapur",
  IN_PROGRESS: "Në proces",
  RESOLVED: "E zgjidhur",
  CLOSED: "E mbyllur",
} as const;

export const PRIORITY_LABELS = {
  LOW: "E ulët",
  MEDIUM: "Mesatare",
  HIGH: "E lartë",
  URGENT: "Urgjente",
} as const;

export type TicketStatusKey = keyof typeof STATUS_LABELS;
export type TicketPriorityKey = keyof typeof PRIORITY_LABELS;

export function TicketStatusBadge({ status }: { status: TicketStatusKey }) {
  const variant = status === "OPEN" ? "default" : status === "IN_PROGRESS" ? "secondary" : "outline";
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

export function TicketPriorityBadge({ priority }: { priority: TicketPriorityKey }) {
  const variant = priority === "URGENT" || priority === "HIGH" ? "destructive" : "outline";
  return <Badge variant={variant}>{PRIORITY_LABELS[priority]}</Badge>;
}
