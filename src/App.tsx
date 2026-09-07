import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
} from "convex/react";
import { SignInButton, UserButton } from "@clerk/react";
import { useEffect, useState } from "react";
import { api } from "../convex/_generated/api";
import Canvas from "./Canvas.tsx";

function SignedInApp() {
  const bootstrap = useMutation(api.users.bootstrap);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let active = true;
    void bootstrap({})
      .then(() => {
        if (active) setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [bootstrap]);

  if (status === "loading") {
    return <div className="app-state">Preparing your project…</div>;
  }
  if (status === "error") {
    return <div className="app-state">Unable to prepare your project.</div>;
  }

  return (
    <main className="app-shell">
      <div className="account-control">
        <UserButton />
      </div>
      <Canvas />
    </main>
  );
}

export default function App() {
  return (
    <>
      <AuthLoading>
        <div className="app-state">Loading…</div>
      </AuthLoading>
      <Unauthenticated>
        <div className="sign-in">
          <h1>Aleph</h1>
          <p>Sign in to open your projects.</p>
          <SignInButton mode="modal">
            <button type="button">Continue with Google</button>
          </SignInButton>
        </div>
      </Unauthenticated>
      <Authenticated>
        <SignedInApp />
      </Authenticated>
    </>
  );
}
