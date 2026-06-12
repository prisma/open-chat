// Top-level gate: resolves the Better Auth session (signing visitors in
// anonymously when there is none) and picks between the auth screen and
// the chat app. The UI itself lives in components/.
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "@tanstack/react-db";
import { resetAfterAuthTransition } from "./actions";
import { authClient } from "./auth-client";
import { AuthView } from "./components/AuthView";
import { AuthenticatedChatApp } from "./components/ChatApp";
import { uiCollection, updateUi } from "./db";
import { stopChatStream } from "./stream";

export function App() {
  const session = authClient.useSession();
  const { data: uiData } = useLiveQuery(uiCollection);
  const showAuthScreen = uiData[0]?.showAuthScreen ?? false;
  const [guestSignInFailed, setGuestSignInFailed] = useState(false);
  const guestSignInPending = useRef(false);
  const userId = session.data?.user.id ?? "";
  const userName = session.data?.user.name || "Account";
  const isAnonymous = Boolean(
    (session.data?.user as { isAnonymous?: boolean | null } | undefined)
      ?.isAnonymous,
  );

  const lastUserId = useRef("");
  useEffect(() => {
    const previous = lastUserId.current;
    lastUserId.current = userId;
    // Only an identity *change* (sign-out, or a guest becoming an account)
    // resets client state. The initial session resolution on page load must
    // not — resetClientState clears the #/chat permalink from the URL, and
    // a reload would always land on the top chat instead of the linked one.
    if (!previous || previous === userId) return;
    stopChatStream();
    resetAfterAuthTransition();
  }, [userId]);

  // Signed-out visitors get an anonymous session automatically; the auth
  // screen is opt-in via the sidebar's sign-in button.
  useEffect(() => {
    if (session.isPending || session.data || guestSignInPending.current) {
      return;
    }
    guestSignInPending.current = true;
    void authClient.signIn
      .anonymous()
      .catch(() => setGuestSignInFailed(true))
      .finally(() => {
        guestSignInPending.current = false;
      });
  }, [session.isPending, session.data]);

  // While the session resolves (and a guest session is created if needed)
  // render nothing — the boot overlay from index.html is still covering
  // the screen, so the user sees a single loading state.
  if (session.isPending) {
    return null;
  }

  if (!session.data) {
    return guestSignInFailed ? <AuthView /> : null;
  }

  if (showAuthScreen && isAnonymous) {
    return (
      <AuthView
        onCancel={() =>
          updateUi((state) => {
            state.showAuthScreen = false;
          })
        }
      />
    );
  }

  return (
    <AuthenticatedChatApp userName={userName} isAnonymous={isAnonymous} />
  );
}
