import { MessagesSquare } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

// Right pane when no conversation is open (desktop only; on phone the list fills the screen).
export default function ConversationsIndexPage() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessagesSquare />
        </EmptyMedia>
        <EmptyTitle>Zgjidhni një bisedë</EmptyTitle>
        <EmptyDescription>Hapni një bisedë nga lista për të parë mesazhet dhe për t&apos;iu përgjigjur klientit.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
