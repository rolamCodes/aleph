import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import type { Doc } from "../_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";

type DatabaseCtx = QueryCtx | MutationCtx;

export async function getClerkIdentity(ctx: DatabaseCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  return identity;
}

export async function findUserByClerkId(
  ctx: DatabaseCtx,
  clerkId: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
}

export async function requireCurrentUser(
  ctx: DatabaseCtx,
): Promise<Doc<"users">> {
  const identity = await getClerkIdentity(ctx);
  const user = await findUserByClerkId(ctx, identity.subject);
  if (!user) {
    throw new Error("User has not been initialized");
  }
  return user;
}

export const authedQuery = customQuery(query, {
  args: {},
  input: async (ctx, args) => ({
    ctx: { user: await requireCurrentUser(ctx) },
    args,
  }),
});

export const authedMutation = customMutation(mutation, {
  args: {},
  input: async (ctx, args) => ({
    ctx: { user: await requireCurrentUser(ctx) },
    args,
  }),
});
