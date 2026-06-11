// The sign-in / sign-up screen: email+password through Better Auth, plus
// whichever social providers the server reports as configured. Guests
// reach it from the sidebar's sign-in button and can back out via
// onCancel.
import { AlertCircle } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { reportClientError } from "../actions";
import { authClient } from "../auth-client";
import { dismissBootScreen } from "../boot";
import { configCollection, uiCollection, updateUi } from "../db";
import { LogoMark } from "./LogoMark";

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.28v-3.1H1.29a12 12 0 0 0 0 10.76l3.98-3.1Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.43-3.43A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.29 6.62l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77Z" />
    </svg>
  );
}

export function AuthView({ onCancel }: { onCancel?: (() => void) | undefined }) {
  const { data: uiData } = useLiveQuery(uiCollection);
  const { data: configData } = useLiveQuery(configCollection);
  const mode = uiData[0]?.authMode ?? "sign-in";
  const isSignUp = mode === "sign-up";
  const providers = configData[0]?.socialProviders ?? [];
  const [error, setError] = useState<string | undefined>();

  useEffect(dismissBootScreen, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "");

    const result = isSignUp
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message ?? "Authentication failed");
    }
  }

  async function social(provider: "github" | "google") {
    setError(undefined);
    const result = await authClient.signIn.social({
      provider,
      callbackURL: "/",
    });
    if (result.error) {
      setError(result.error.message ?? `Could not start ${provider} sign-in`);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="wordmark-glyph">
          <LogoMark size={17} />
        </div>
        <h1 id="auth-title">Open Chat</h1>
        <p>
          {isSignUp
            ? "Create an account and get $2.00 in free credit."
            : "Durable chats, streamed live and replayed on demand."}
        </p>
        {providers.length ? (
          <div className="social-buttons">
            {providers.includes("github") ? (
              <button
                className="button social"
                type="button"
                onClick={() => void social("github").catch(reportClientError)}
              >
                <GitHubIcon /> Continue with GitHub
              </button>
            ) : null}
            {providers.includes("google") ? (
              <button
                className="button social"
                type="button"
                onClick={() => void social("google").catch(reportClientError)}
              >
                <GoogleIcon /> Continue with Google
              </button>
            ) : null}
            <div className="auth-divider" role="presentation">
              or
            </div>
          </div>
        ) : null}
        <form className="auth-form" onSubmit={submit}>
          {isSignUp ? (
            <label>
              Name
              <input name="name" autoComplete="name" required />
            </label>
          ) : null}
          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={8}
              required
            />
          </label>
          {error ? (
            <div className="auth-error" role="alert">
              <AlertCircle size={14} aria-hidden />
              {error}
            </div>
          ) : null}
          <button className="button primary" type="submit">
            {isSignUp ? "Create account" : "Sign in"}
          </button>
        </form>
        <button
          className="text-button"
          type="button"
          onClick={() =>
            updateUi((state) => {
              state.authMode = isSignUp ? "sign-in" : "sign-up";
            })
          }
        >
          {isSignUp
            ? "Already have an account? Sign in"
            : "New here? Create an account"}
        </button>
        {onCancel ? (
          <button className="text-button" type="button" onClick={onCancel}>
            Continue as guest
          </button>
        ) : null}
      </section>
    </main>
  );
}
