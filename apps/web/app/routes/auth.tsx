import { data, Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/auth";
import {
  buildAuthConfirmUrl,
  getSafeNextPath,
} from "../lib/auth-redirect";
import { hasSupabasePublicEnv, type AppEnv } from "../lib/env.server";
import { createSupabaseServerClient } from "../lib/supabase/server";
import { getViewer } from "../lib/viewer.server";

type AuthActionData = {
  error?: string;
  success?: string;
  fields?: {
    displayName?: string;
    email?: string;
    next?: string;
  };
  intent?: "sign-in" | "sign-up";
};

export const meta: Route.MetaFunction = () => [
  { title: "HNSkim | Auth" },
  {
    name: "description",
    content:
      "Sign in to HNSkim to save or dismiss stories and keep a personal Hacker News skim list.",
  },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env as AppEnv;
  const url = new URL(request.url);
  const next = getSafeNextPath(url.searchParams.get("next"));
  const redirectError = normalizeQueryMessage(url.searchParams.get("error"));
  const { responseHeaders, viewer } = await getViewer({ env, request });

  if (viewer) {
    return redirect(next, { headers: responseHeaders });
  }

  return data(
    {
      isConfigured: hasSupabasePublicEnv(env),
      next,
      redirectError,
    },
    { headers: responseHeaders },
  );
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env as AppEnv;

  if (!hasSupabasePublicEnv(env)) {
    return data<AuthActionData>(
      {
        error: "Supabase public bindings are not configured yet.",
      },
      { status: 500 },
    );
  }

  const responseHeaders = new Headers();
  const supabase = createSupabaseServerClient({
    env,
    request,
    responseHeaders,
  });
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = getSafeNextPath(formData.get("next"));

  if (!email || !password) {
    return data<AuthActionData>(
      {
        error: "Email and password are both required.",
        fields: { displayName, email, next },
        intent: intent === "sign-up" ? "sign-up" : "sign-in",
      },
      { headers: responseHeaders, status: 400 },
    );
  }

  if (intent === "sign-up") {
    if (displayName.length < 2) {
      return data<AuthActionData>(
        {
          error: "Display name must be at least 2 characters long.",
          fields: { displayName, email, next },
          intent: "sign-up",
        },
        { headers: responseHeaders, status: 400 },
      );
    }

    const { data: signUpData, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
        emailRedirectTo: buildAuthConfirmUrl(request, next),
      },
    });

    if (error) {
      return data<AuthActionData>(
        {
          error: error.message,
          fields: { displayName, email, next },
          intent: "sign-up",
        },
        { headers: responseHeaders, status: 400 },
      );
    }

    if (signUpData.session) {
      return redirect(next, { headers: responseHeaders });
    }

    return data<AuthActionData>(
      {
        success:
          "Account created. If email confirmations are enabled in Supabase, use the link in your inbox before signing in.",
        fields: { email, next },
        intent: "sign-up",
      },
      { headers: responseHeaders },
    );
  }

  if (intent === "sign-in") {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return data<AuthActionData>(
        {
          error: error.message,
          fields: { email, next },
          intent: "sign-in",
        },
        { headers: responseHeaders, status: 400 },
      );
    }

    return redirect(next, { headers: responseHeaders });
  }

  return data<AuthActionData>(
    {
      error: "Unknown authentication action.",
      fields: { displayName, email, next },
    },
    { headers: responseHeaders, status: 400 },
  );
}

export default function AuthRoute({ actionData, loaderData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const errorMessage = actionData?.error ?? loaderData.redirectError;
  const formAction = `/auth?next=${encodeURIComponent(loaderData.next)}`;

  if (!loaderData.isConfigured) {
    return (
      <main className="page">
        <section className="route-panel">
          <p className="eyebrow">Setup required</p>
          <h1 className="panel-title">Supabase auth is not configured yet.</h1>
          <p className="panel-copy">
            Add <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> to{" "}
            <code>apps/web/.dev.vars</code> and your Worker secrets before using sign-in, save, or
            dismiss state.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" to="/diagnostics">
              Open diagnostics
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page auth-page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Personal state</p>
          <h1 className="hero-title">Sign in to save the few stories that matter.</h1>
          <p className="hero-text">
            Authentication is deliberately narrow in the MVP: email/password auth, automatic
            profile creation in Supabase, and enough identity to persist save and dismiss state.
          </p>
          <div className="hero-actions">
            <Link className="button button-secondary" to="/">
              Back to feed
            </Link>
          </div>
        </div>
        <aside className="hero-aside">
          <p className="eyebrow">What auth unlocks</p>
          <ul className="feature-list">
            <li>Save stories you want to revisit later.</li>
            <li>Dismiss noise so the feed stays lean.</li>
            <li>Keep profile ownership in the database layer, not the browser only.</li>
          </ul>
        </aside>
      </section>

      {errorMessage ? <div className="message-banner is-error">{errorMessage}</div> : null}
      {actionData?.success ? (
        <div className="message-banner is-success">{actionData.success}</div>
      ) : null}

      <section className="auth-grid">
        <section className="route-panel">
          <p className="eyebrow">Sign in</p>
          <h2 className="panel-title">Return to your saved queue.</h2>
          <Form method="post" action={formAction} className="auth-form">
            <input type="hidden" name="intent" value="sign-in" />
            <input type="hidden" name="next" value={loaderData.next} />
            <label className="field">
              <span className="field-label">Email</span>
              <input
                required
                name="email"
                type="email"
                defaultValue={actionData?.fields?.email ?? ""}
                className="field-input"
              />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input required name="password" type="password" className="field-input" />
            </label>
            <button className="button button-primary auth-submit" disabled={isSubmitting} type="submit">
              {isSubmitting && actionData?.intent === "sign-in" ? "Signing in..." : "Sign in"}
            </button>
          </Form>
        </section>

        <section className="route-panel">
          <p className="eyebrow">Create account</p>
          <h2 className="panel-title">Start tracking your own signal.</h2>
          <Form method="post" action={formAction} className="auth-form">
            <input type="hidden" name="intent" value="sign-up" />
            <input type="hidden" name="next" value={loaderData.next} />
            <label className="field">
              <span className="field-label">Display name</span>
              <input
                required
                minLength={2}
                name="displayName"
                type="text"
                defaultValue={actionData?.fields?.displayName ?? ""}
                className="field-input"
              />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input
                required
                name="email"
                type="email"
                defaultValue={actionData?.fields?.email ?? ""}
                className="field-input"
              />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input required minLength={8} name="password" type="password" className="field-input" />
            </label>
            <button className="button button-primary auth-submit" disabled={isSubmitting} type="submit">
              {isSubmitting && actionData?.intent === "sign-up" ? "Creating account..." : "Create account"}
            </button>
          </Form>
        </section>
      </section>
    </main>
  );
}

function normalizeQueryMessage(value: string | null) {
  if (!value) {
    return null;
  }

  const message = value.trim();
  return message.length > 0 ? message : null;
}
