import { ListSlot } from "../../_lib/list-slot";

export default async function ConversationListWithActivePage({ params, searchParams }: PageProps<"/conversations/[id]">) {
  const { id } = await params;
  return <ListSlot searchParams={searchParams} activeId={id} />;
}
