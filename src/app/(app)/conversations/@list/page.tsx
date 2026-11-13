import { ListSlot } from "../_lib/list-slot";

export default function ConversationListPage({ searchParams }: PageProps<"/conversations">) {
  return <ListSlot searchParams={searchParams} />;
}
