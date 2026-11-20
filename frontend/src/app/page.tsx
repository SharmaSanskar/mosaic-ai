import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  GitBranch,
  KeyRound,
  Radio,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Wordmark, BrandMark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const appHref = user ? "/dashboard" : "/signup";
  const appLabel = user ? "Open app" : "Start free";

  return (
    <>
      {/* Nav */}
      <header className="nav sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="wrap flex h-16 items-center justify-between">
          <Wordmark />
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#agents" className="transition-colors hover:text-foreground">Agents</a>
            <a href="#visualize" className="transition-colors hover:text-foreground">Visualize</a>
            <a href="#realtime" className="transition-colors hover:text-foreground">Real-time</a>
            <a href="#models" className="transition-colors hover:text-foreground">Your models</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              className="hidden min-h-11 sm:inline-flex sm:min-h-0"
              render={<Link href="/login" />}
            >
              Log in
            </Button>
            <Button size="sm" className="min-h-11 sm:min-h-0" render={<Link href={appHref} />}>
              {appLabel}
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-40 h-[32rem] opacity-70"
            style={{
              background:
                "radial-gradient(60% 60% at 50% 0%, color-mix(in oklch, var(--primary) 26%, transparent), transparent 70%)",
            }}
          />
          <div className="wrap pt-16 pb-14 sm:pt-24">
            <div className="animate-in fade-in-0 slide-in-from-bottom-4 fill-mode-both duration-700 mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1 text-xs text-muted-foreground">
                <Sparkles className="size-3.5 text-primary" />
                Humans and many AIs, in one live room
              </span>
              <h1 className="mt-5 text-balance text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
                One room. Your whole team
                <br className="hidden sm:block" /> and a bench of AIs.
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
                Mosaic is a real-time workspace where people and multiple AI agents
                chat together, watch a reasoning diagram draw itself, and pin the
                decisions worth keeping.
              </p>
              <div className="mt-7 flex items-center justify-center gap-3">
                <Button size="lg" render={<Link href={appHref} />}>
                  {appLabel}
                  <ArrowRight />
                </Button>
                <Button variant="outline" size="lg" render={<Link href="/login" />}>
                  Log in
                </Button>
              </div>
              <p className="mt-4 font-mono text-xs text-muted-foreground">
                Tag @researcher and @critic in one message — both answer at once.
              </p>
            </div>

            <div className="animate-in fade-in-0 slide-in-from-bottom-6 fill-mode-both duration-1000 [animation-delay:150ms] mt-14">
              <ProductFrame />
            </div>
          </div>
        </section>

        <FeatureRow
          id="agents"
          icon={<Boxes className="size-5" />}
          eyebrow="Multi-agent"
          title="Call several AIs by name — they reply side by side."
          body="Each agent has its own @handle, persona, and model. Mention two and they generate concurrently, so a researcher and a critic can weigh in on the same question at the same time."
          visual={<AgentsVisual />}
        />

        <FeatureRow
          id="visualize"
          icon={<GitBranch className="size-5" />}
          eyebrow="Generative visualization"
          title="The conversation draws its own diagram."
          body="After each reply, Mosaic asks the model for the single diagram that best fits the discussion — a flowchart, a timeline, a mind map — and renders it live. No fixed template."
          visual={<VizVisual />}
          reverse
        />

        <FeatureRow
          id="realtime"
          icon={<Radio className="size-5" />}
          eyebrow="Real-time"
          title="Everyone sees everything, the instant it happens."
          body="Presence, typing indicators, streaming AI replies, and a shared moodboard sync over a Go WebSocket hub — so a room of people and agents stays in lockstep."
          visual={<RealtimeVisual />}
        />

        <FeatureRow
          id="models"
          icon={<KeyRound className="size-5" />}
          eyebrow="Your models"
          title="Bring your own keys, for any provider."
          body="Add your OpenAI, Anthropic, or Google keys — encrypted at rest with AES-256-GCM — and point custom agents at whichever model you prefer. Your keys never leave the server in the clear."
          visual={<ModelsVisual />}
          reverse
        />

        {/* CTA band — its own section with its own ground */}
        <section className="relative overflow-hidden border-y border-border bg-card">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(50% 80% at 50% 0%, color-mix(in oklch, var(--primary) 18%, transparent), transparent 70%)",
            }}
          />
          <div className="wrap py-24 text-center">
            <h2 className="mx-auto max-w-xl text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Start a room, invite your team and AIs.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-muted-foreground">
              Free to try. Create a room, share the code, and think together.
            </p>
            <Button size="lg" className="mt-7" render={<Link href={appHref} />}>
              {appLabel}
              <ArrowRight />
            </Button>
          </div>
        </section>
      </main>

      <footer className="closing border-t border-border/60">
        <div className="wrap flex flex-col items-center justify-between gap-3 py-8 text-sm text-muted-foreground sm:flex-row">
          <Wordmark />
          <span className="font-mono text-xs">
            Real-time collaboration for humans and AIs.
          </span>
        </div>
      </footer>
    </>
  );
}

/* ---------- section scaffold ---------- */

function FeatureRow({
  id,
  icon,
  eyebrow,
  title,
  body,
  visual,
  reverse,
}: {
  id: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: string;
  visual: React.ReactNode;
  reverse?: boolean;
}) {
  return (
    <section id={id} className="py-20 sm:py-24">
      <div className="wrap">
        <div className="grid items-start gap-10 md:grid-cols-2">
          <div className={reverse ? "md:order-2" : ""}>
            <span className="inline-flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              {icon}
            </span>
            <p className="mt-4 text-xs font-medium uppercase tracking-widest text-primary">
              {eyebrow}
            </p>
            <h2 className="mt-2 text-balance text-3xl font-semibold tracking-tight">
              {title}
            </h2>
            <p className="mt-3 max-w-md text-pretty leading-relaxed text-muted-foreground">
              {body}
            </p>
          </div>
          <div className={reverse ? "md:order-1" : ""}>{visual}</div>
        </div>
      </div>
    </section>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={
        "rounded-2xl border border-border bg-card p-4 shadow-sm ring-1 ring-foreground/5 " +
        (className ?? "")
      }
    >
      {children}
    </div>
  );
}

/* ---------- hero product frame ---------- */

function ProductFrame() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ring-1 ring-foreground/10">
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-chart-4/70" />
        <span className="size-2.5 rounded-full bg-chart-5/70" />
        <span className="size-2.5 rounded-full bg-chart-2/70" />
        <div className="ml-3 flex items-center gap-2 text-xs text-muted-foreground">
          <BrandMark className="size-3.5 text-foreground" />
          <span className="font-mono">mosaic / product-launch</span>
        </div>
      </div>
      <div className="grid min-h-[22rem] grid-cols-1 divide-border/70 md:grid-cols-[1.1fr_1.2fr_0.9fr] md:divide-x">
        <div className="flex flex-col gap-3 p-4">
          <div className="text-[11px] font-semibold tracking-tight text-muted-foreground">Chat</div>
          <Bubble name="maya" color="var(--chart-1)" own>
            Should we ship the beta this week? @researcher @critic
          </Bubble>
          <Bubble name="researcher" color="var(--chart-2)" agent>
            Usage is stable and the top 3 bugs are closed. Shipping now captures the launch window.
          </Bubble>
          <Bubble name="critic" color="var(--chart-4)" agent typing>
            Two risks remain: onboarding drop-off and the billing edge case…
          </Bubble>
        </div>
        <div className="flex flex-col gap-3 border-t border-border/70 p-4 md:border-t-0">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold tracking-tight text-muted-foreground">Reasoning map</div>
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              flowchart
            </span>
          </div>
          <MiniFlow />
        </div>
        <div className="flex flex-col gap-3 border-t border-border/70 p-4 md:border-t-0">
          <div className="text-[11px] font-semibold tracking-tight text-muted-foreground">Moodboard</div>
          <PinCard color="var(--chart-2)" who="researcher">
            Ship beta Thursday, gate billing behind a flag.
          </PinCard>
          <PinCard color="var(--chart-1)" who="maya">
            Owner: Maya · revisit onboarding next sprint.
          </PinCard>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  name,
  color,
  children,
  own,
  agent,
  typing,
}: {
  name: string;
  color: string;
  children: React.ReactNode;
  own?: boolean;
  agent?: boolean;
  typing?: boolean;
}) {
  return (
    <div className={"flex flex-col gap-1 " + (own ? "items-end" : "items-start")}>
      <span className="flex items-center gap-1.5 px-1 text-[10px] font-medium text-muted-foreground">
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
        {agent ? "@" + name : name}
        {typing && <span className="text-muted-foreground/70">· typing…</span>}
      </span>
      <div
        className={
          "max-w-[92%] rounded-2xl px-3 py-2 text-xs leading-relaxed " +
          (own
            ? "bg-primary text-primary-foreground"
            : agent
              ? "bg-ai-subtle text-foreground"
              : "bg-muted text-foreground")
        }
      >
        {children}
      </div>
    </div>
  );
}

function MiniFlow() {
  return (
    <svg viewBox="0 0 220 180" className="h-full w-full" role="img" aria-label="Example reasoning flowchart">
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" className="fill-muted-foreground" />
        </marker>
      </defs>
      {[
        { x: 70, y: 12, w: 80, label: "Ship beta?", fill: "var(--chart-3)" },
        { x: 14, y: 78, w: 86, label: "Bugs closed", fill: "var(--chart-2)" },
        { x: 120, y: 78, w: 86, label: "Risks open", fill: "var(--chart-4)" },
        { x: 66, y: 142, w: 90, label: "Ship w/ flag", fill: "var(--chart-1)" },
      ].map((n, i) => (
        <g key={i}>
          <rect x={n.x} y={n.y} width={n.w} height="26" rx="7" fill="color-mix(in oklch, var(--card), var(--foreground) 4%)" stroke={n.fill} strokeWidth="1.5" />
          <text x={n.x + n.w / 2} y={n.y + 17} textAnchor="middle" className="fill-foreground" style={{ fontSize: 10 }}>
            {n.label}
          </text>
        </g>
      ))}
      <path d="M95,38 L57,78" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.3" markerEnd="url(#arrow)" />
      <path d="M125,38 L163,78" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.3" markerEnd="url(#arrow)" />
      <path d="M57,104 L104,142" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.3" markerEnd="url(#arrow)" />
      <path d="M163,104 L118,142" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.3" markerEnd="url(#arrow)" />
    </svg>
  );
}

function PinCard({ color, who, children }: { color: string; who: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border-l-2 bg-muted/40 px-3 py-2" style={{ borderLeftColor: color }}>
      <p className="text-xs leading-relaxed">{children}</p>
      <p className="mt-1 font-mono text-[9px] text-muted-foreground">{who}</p>
    </div>
  );
}

/* ---------- feature visuals ---------- */

function AgentsVisual() {
  const agents = [
    { h: "assistant", c: "var(--chart-1)", m: "gpt-4o-mini" },
    { h: "researcher", c: "var(--chart-2)", m: "gpt-4o" },
    { h: "critic", c: "var(--chart-4)", m: "gpt-4o-mini" },
  ];
  return (
    <Panel>
      <div className="flex flex-col gap-2">
        {agents.map((a) => (
          <div
            key={a.h}
            className="flex items-center justify-between rounded-lg border border-border/70 bg-background/40 px-3 py-2 transition-transform hover:-translate-y-0.5"
          >
            <span className="flex items-center gap-2 text-sm">
              <span className="flex size-6 items-center justify-center rounded-md text-[10px] font-semibold text-white" style={{ backgroundColor: a.c }}>
                <Sparkles className="size-3" />
              </span>
              <span className="font-medium">@{a.h}</span>
            </span>
            <span className="font-mono text-xs text-muted-foreground">{a.m}</span>
          </div>
        ))}
        <div className="mt-1 rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary ring-1 ring-primary/20">
          @researcher and @critic are replying at the same time…
        </div>
      </div>
    </Panel>
  );
}

function VizVisual() {
  const types = ["flowchart", "timeline", "mindmap", "sequence", "state", "gantt"];
  return (
    <Panel>
      <MiniFlow />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {types.map((t, i) => (
          <span
            key={t}
            className={
              "rounded-full px-2.5 py-1 font-mono text-[10px] " +
              (i === 0
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground")
            }
          >
            {t}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function RealtimeVisual() {
  return (
    <Panel>
      <div className="flex items-center justify-between">
        <div className="flex items-center -space-x-2">
          {["var(--chart-1)", "var(--chart-2)", "var(--chart-4)", "var(--chart-5)"].map((c, i) => (
            <span
              key={i}
              className="flex size-8 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-2 ring-card"
              style={{ backgroundColor: c }}
            >
              {["M", "J", "A", "R"][i]}
            </span>
          ))}
          <span className="flex size-8 items-center justify-center rounded-full bg-muted text-[10px] ring-2 ring-card">
            +2
          </span>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-chart-2/70" />
            <span className="relative inline-flex size-2 rounded-full bg-chart-2" />
          </span>
          live
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <div className="h-2.5 w-3/4 rounded-full bg-muted" />
        <div className="h-2.5 w-1/2 rounded-full bg-muted" />
        <div className="flex items-center gap-1.5 text-xs italic text-muted-foreground">
          Jordan is typing
          <span className="inline-flex gap-0.5">
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
            <span className="size-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
          </span>
        </div>
      </div>
    </Panel>
  );
}

function ModelsVisual() {
  const providers = [
    { name: "OpenAI", tag: "gpt-4o" },
    { name: "Anthropic", tag: "claude" },
    { name: "Google", tag: "gemini" },
  ];
  return (
    <Panel>
      <div className="flex flex-col gap-2">
        {providers.map((p) => (
          <div
            key={p.name}
            className="flex items-center justify-between rounded-lg border border-border/70 bg-background/40 px-3 py-2.5 transition-transform hover:-translate-y-0.5"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-md bg-muted font-mono text-[11px] font-semibold">
                {p.name[0]}
              </span>
              <span className="text-sm font-medium">{p.name}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">••••{p.tag}</span>
              <KeyRound className="size-3.5 text-muted-foreground" />
            </span>
          </div>
        ))}
        <p className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          <KeyRound className="size-3 text-chart-2" />
          Encrypted with AES-256-GCM. Never returned in the clear.
        </p>
      </div>
    </Panel>
  );
}
