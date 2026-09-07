import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { findUserByClerkId, getClerkIdentity } from "./lib/auth";

const FIRST_PROJECT_NAME = "Your first project";

export const bootstrap = mutation({
  args: {},
  returns: v.id("projects"),
  handler: async (ctx) => {
    const identity = await getClerkIdentity(ctx);
    const now = Date.now();
    let user = await findUserByClerkId(ctx, identity.subject);

    if (user) {
      await ctx.db.patch("users", user._id, {
        name: identity.name,
        email: identity.email,
        imageUrl: identity.pictureUrl,
        updatedAt: now,
      });
    } else {
      const userId = await ctx.db.insert("users", {
        clerkId: identity.subject,
        name: identity.name,
        email: identity.email,
        imageUrl: identity.pictureUrl,
        createdAt: now,
        updatedAt: now,
      });
      user = await ctx.db.get("users", userId);
    }

    if (!user) {
      throw new Error("Failed to initialize user");
    }

    const project = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (project) {
      return project._id;
    }

    return await ctx.db.insert("projects", {
      userId: user._id,
      name: FIRST_PROJECT_NAME,
      nodes: [],
      edges: [],
      createdAt: now,
      updatedAt: now,
    });
  },
});
