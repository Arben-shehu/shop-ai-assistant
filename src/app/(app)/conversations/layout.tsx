import { PageHeader } from "@/components/page-header";
import { InboxShell } from "@/components/conversations/inbox-shell";

export default function ConversationsLayout({ children, list }: LayoutProps<"/conversations">) {
  return (
    <InboxShell header={<PageHeader title="Bisedat" description="Ndiqni bisedat e asistentit AI në kohë reale dhe merrini kur duhet." />} list={list}>
      {children}
    </InboxShell>
  );
}
