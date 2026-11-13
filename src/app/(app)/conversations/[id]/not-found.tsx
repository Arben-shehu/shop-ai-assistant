import Link from "next/link";
import { MessageSquareOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function ConversationNotFound() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageSquareOff />
        </EmptyMedia>
        <EmptyTitle>Biseda nuk u gjet</EmptyTitle>
        <EmptyDescription>Kjo bisedë nuk ekziston ose nuk i përket dyqanit tuaj.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline" size="sm">
          <Link href="/conversations">Kthehu te bisedat</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
