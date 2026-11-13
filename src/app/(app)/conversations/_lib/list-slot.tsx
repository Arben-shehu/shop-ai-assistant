import { requireOrg } from "@/lib/session";
import { ConversationList } from "@/components/conversations/conversation-list";
import { filtersQuery, listConversations, parseFilters } from "./queries";

/** The inbox list, rendered by the @list slot on both /conversations and /conversations/[id]. */
export async function ListSlot({
  searchParams,
  activeId,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  activeId?: string;
}) {
  const { orgId } = await requireOrg();
  const filters = parseFilters(await searchParams);
  const items = await listConversations(orgId, filters);
  return <ConversationList items={items} filters={filters} activeId={activeId} query={filtersQuery(filters)} />;
}
