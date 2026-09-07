import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  contextNodeValidator,
  interactionEdgeValidator,
} from "./lib/validators";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_clerk_id", ["clerkId"]),

  projects: defineTable({
    userId: v.id("users"),
    name: v.string(),
    nodes: v.array(contextNodeValidator),
    edges: v.array(interactionEdgeValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  voiceUploads: defineTable({
    userId: v.id("users"),
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
    createdAt: v.number(),
  }).index("by_storage", ["storageId"]),
});
