import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("auth", "routes/auth.tsx"),
  route("auth/callback", "routes/auth-callback.tsx"),
  route("auth/confirm", "routes/auth-confirm.tsx"),
  route("saved", "routes/saved.tsx"),
  route("story/:hnItemId", "routes/story.tsx"),
  route("diagnostics", "routes/diagnostics.tsx"),
  route("logout", "routes/logout.tsx"),
] satisfies RouteConfig;
