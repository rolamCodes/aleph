/* eslint-disable */
/**
 * Generated API references.
 *
 * This file will be replaced by `npx convex dev`.
 */
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as projects from "../projects.js";
import type * as users from "../users.js";
import type * as voice from "../voice.js";

declare const fullApi: ApiFromModules<{
  projects: typeof projects;
  users: typeof users;
  voice: typeof voice;
}>;

export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
