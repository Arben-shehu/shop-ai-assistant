import "server-only";
import type { Channel } from "@/generated/prisma/client";
import type { ChannelCredentials } from "@/lib/channels/types";
import { decryptJson } from "@/lib/crypto";

/** Decrypted Channel.credentials, or null when none are stored. Never send the result to the browser. */
export function loadChannelCredentials(channel: Pick<Channel, "credentials">): ChannelCredentials | null {
  if (!channel.credentials) return null;
  return decryptJson<ChannelCredentials>(channel.credentials);
}
