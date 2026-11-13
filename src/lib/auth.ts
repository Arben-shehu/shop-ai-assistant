import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";
import { prisma } from "@/lib/prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, disableSignUp: true }, // accounts are created by admins only
  trustedOrigins: [process.env.BETTER_AUTH_URL!, "http://localhost:4710"],
  databaseHooks: {
    session: {
      create: {
        // Land every login in the user's first shop so pages always have an active org.
        before: async (session) => {
          const member = await prisma.member.findFirst({
            where: { userId: session.userId },
            orderBy: { createdAt: "asc" },
          });
          return { data: { ...session, activeOrganizationId: member?.organizationId ?? null } };
        },
      },
    },
  },
  plugins: [
    organization({ allowUserToCreateOrganization: false }),
    admin(), // user.role === "admin" is the platform super-admin
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
