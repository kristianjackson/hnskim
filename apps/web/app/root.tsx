import {
  data,
  Form,
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { getPublicEnv, type AppEnv } from "./lib/env.server";
import { serializePublicEnvScript } from "./lib/public-env";
import { getViewer } from "./lib/viewer.server";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Space+Grotesk:wght@400;500;700&display=swap",
  },
];

export const meta: Route.MetaFunction = () => [
  { title: "HNSkim" },
  {
    name: "description",
    content: "A summary-first Hacker News reader built on Cloudflare Workers, React Router, Supabase, and OpenAI.",
  },
];

export async function loader({ context, request }: Route.LoaderArgs) {
  const env = context.cloudflare.env as AppEnv;
  const { responseHeaders, viewer } = await getViewer({ env, request });

  return data(
    {
      publicEnv: getPublicEnv(env),
      viewer,
    },
    { headers: responseHeaders },
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const statusLabel = !loaderData.publicEnv.hasSupabase
    ? "Supabase pending"
    : loaderData.viewer
      ? `Signed in as ${loaderData.viewer.user.displayName}`
      : "Guest session";

  return (
    <>
      <script
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: serializePublicEnvScript(loaderData.publicEnv),
        }}
      />
      <div className="site-shell">
        <header className="site-header">
          <div className="brand-block">
            <p className="eyebrow">Personal news desk</p>
            <NavLink className="brand-mark" to="/">
              {loaderData.publicEnv.appName}
            </NavLink>
          </div>
          <div className="status-panel">
            <span className="status-label">Session</span>
            <strong className="status-value">{statusLabel}</strong>
          </div>
          <nav className="site-nav" aria-label="Primary">
            <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/">
              Feed
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/saved">
              Saved
            </NavLink>
            <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/diagnostics">
              Diagnostics
            </NavLink>
            {loaderData.viewer ? (
              <Form method="post" action="/logout">
                <button className="nav-link nav-button" type="submit">
                  Log Out
                </button>
              </Form>
            ) : (
              <NavLink className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} to="/auth">
                Auth
              </NavLink>
            )}
          </nav>
        </header>
        <Outlet />
      </div>
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Unexpected error";
  let details = "The app shell failed before the request could complete.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Route not found" : `HTTP ${error.status}`;
    details =
      error.status === 404
        ? "This route has not been implemented yet."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="page">
      <section className="route-panel">
        <p className="eyebrow">HNSkim</p>
        <h1 className="panel-title">{message}</h1>
        <p className="panel-copy">{details}</p>
        {stack ? (
          <pre className="error-stack">
            <code>{stack}</code>
          </pre>
        ) : null}
      </section>
    </main>
  );
}
