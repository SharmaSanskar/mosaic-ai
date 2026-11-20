"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Wordmark, BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AuthFormProps {
  mode: "login" | "signup";
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const isSignup = mode === "signup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const { error } = isSignup
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="grid min-h-screen flex-1 md:grid-cols-2">
      {/* Showcase panel */}
      <aside className="relative hidden overflow-hidden border-r border-border bg-card md:flex md:flex-col md:justify-between md:p-10">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(50% 50% at 20% 10%, color-mix(in oklch, var(--primary) 22%, transparent), transparent 70%)",
          }}
        />
        <Link href="/" className="relative">
          <Wordmark />
        </Link>
        <div className="relative max-w-sm">
          <h2 className="text-balance text-3xl font-semibold leading-tight tracking-tight">
            One room for your team and a bench of AIs.
          </h2>
          <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
            Chat together, watch the reasoning diagram draw itself, and pin the
            decisions worth keeping — all in real time.
          </p>
          <ul className="mt-6 flex flex-col gap-2.5 text-sm text-muted-foreground">
            {[
              "Mention several AIs — they answer at once",
              "A diagram that fits the conversation",
              "Presence, typing, and a shared moodboard",
            ].map((line) => (
              <li key={line} className="flex items-center gap-2.5">
                <BrandMark className="size-3.5 text-foreground" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <span className="relative font-mono text-xs text-muted-foreground">
          Real-time collaboration for humans and AIs.
        </span>
      </aside>

      {/* Form panel */}
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground md:hidden"
          >
            <ArrowLeft className="size-4" /> Home
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight">
            {isSignup ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {isSignup
              ? "Sign up with your email to start a room."
              : "Log in to pick up where your team left off."}
          </p>

          <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-3">
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="h-10"
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={isSignup ? "new-password" : "current-password"}
              className="h-10"
            />
            <Button type="submit" size="lg" disabled={loading} className="mt-1 w-full">
              {loading ? "Please wait…" : isSignup ? "Create account" : "Log in"}
            </Button>
          </form>

          <p className="mt-6 text-sm text-muted-foreground">
            {isSignup ? (
              <>
                Already have an account?{" "}
                <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
                  Log in
                </Link>
              </>
            ) : (
              <>
                Don&apos;t have an account?{" "}
                <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
                  Sign up
                </Link>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
