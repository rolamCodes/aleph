import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { authedMutation, authedQuery, findUserByClerkId } from "./lib/auth";
import { applyGraphOperation } from "./lib/graphPatch";
import {
  graphOperationValidator,
  graphValidator,
  interactionEdgeValidator,
  contextNodeValidator,
  patchLayoutValidator,
  projectDocumentValidator,
} from "./lib/validators";
import type { Doc, Id } from "./_generated/dataModel";

type DatabaseCtx = QueryCtx | MutationCtx;

async function requireOwnedProject(
  ctx: DatabaseCtx,
  projectId: Id<"projects">,
  userId: Id<"users">,
): Promise<Doc<"projects">> {
  const project = await ctx.db.get("projects", projectId);
  if (!project) throw new Error("Project not found");
  if (project.userId !== userId) throw new Error("Unauthorized project access");
  return project;
}

async function requireOwnedProjectByClerkId(
  ctx: DatabaseCtx,
  projectId: Id<"projects">,
  clerkId: string,
): Promise<Doc<"projects">> {
  const user = await findUserByClerkId(ctx, clerkId);
  if (!user) throw new Error("User has not been initialized");
  return await requireOwnedProject(ctx, projectId, user._id);
}

export const current = authedQuery({
  args: {},
  returns: v.union(projectDocumentValidator, v.null()),
  handler: async (ctx) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .first();
  },
});

export const get = authedQuery({
  args: { projectId: v.id("projects") },
  returns: projectDocumentValidator,
  handler: async (ctx, args) => {
    return await requireOwnedProject(ctx, args.projectId, ctx.user._id);
  },
});

export const list = authedQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(projectDocumentValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", ctx.user._id))
      .order("asc")
      .paginate(args.paginationOpts);
  },
});

export const replaceGraph = authedMutation({
  args: {
    projectId: v.id("projects"),
    nodes: v.array(contextNodeValidator),
    edges: v.array(interactionEdgeValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnedProject(ctx, args.projectId, ctx.user._id);
    await ctx.db.patch("projects", args.projectId, {
      nodes: args.nodes,
      edges: args.edges,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const generateUploadUrl = authedMutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const registerVoiceUpload = authedMutation({
  args: {
    projectId: v.id("projects"),
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOwnedProject(ctx, args.projectId, ctx.user._id);
    await ctx.db.insert("voiceUploads", {
      userId: ctx.user._id,
      projectId: args.projectId,
      storageId: args.storageId,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const getVoiceInput = internalQuery({
  args: {
    projectId: v.id("projects"),
    clerkId: v.string(),
    storageId: v.id("_storage"),
  },
  returns: v.object({
    graph: graphValidator,
    audioUrl: v.string(),
  }),
  handler: async (ctx, args) => {
    const project = await requireOwnedProjectByClerkId(
      ctx,
      args.projectId,
      args.clerkId,
    );
    const upload = await ctx.db
      .query("voiceUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (
      !upload ||
      upload.userId !== project.userId ||
      upload.projectId !== project._id
    ) {
      throw new Error("Unauthorized voice recording");
    }
    const audioUrl = await ctx.storage.getUrl(args.storageId);
    if (!audioUrl) throw new Error("Voice recording not found");
    return {
      graph: { nodes: project.nodes, edges: project.edges },
      audioUrl,
    };
  },
});

export const applyVoiceOperation = internalMutation({
  args: {
    projectId: v.id("projects"),
    clerkId: v.string(),
    operation: graphOperationValidator,
    layout: patchLayoutValidator,
  },
  returns: graphValidator,
  handler: async (ctx, args) => {
    const project = await requireOwnedProjectByClerkId(
      ctx,
      args.projectId,
      args.clerkId,
    );
    const graph = applyGraphOperation(
      { nodes: project.nodes, edges: project.edges },
      args.operation,
      args.layout,
    );
    await ctx.db.patch("projects", project._id, {
      nodes: graph.nodes,
      edges: graph.edges,
      updatedAt: Date.now(),
    });
    return graph;
  },
});

export const deleteVoiceAudio = internalMutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const upload = await ctx.db
      .query("voiceUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .unique();
    if (upload) await ctx.db.delete("voiceUploads", upload._id);
    await ctx.storage.delete(args.storageId);
    return null;
  },
});
