"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare, Network, Pin } from "lucide-react";
import {
  useDefaultLayout,
  usePanelRef,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { RoomSocketProvider } from "@/lib/room-socket-context";
import { RoomStatus } from "@/components/room/room-status";
import { ChatPane } from "@/components/room/chat-pane";
import { RoomTitle } from "@/components/room/room-title";
import { VizPane } from "@/components/room/viz-pane";
import { ArtifactsPane } from "@/components/room/artifacts-pane";
import { AgentsDialog } from "@/components/room/agents-dialog";
import { PresenceBar } from "@/components/room/presence-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { Room } from "@/lib/types";

interface RoomShellProps {
  room: Room;
}

// react-resizable-panels' useDefaultLayout defaults to the bare `localStorage`
// global, which isn't a real Storage implementation during Next.js's
// server-side render pass — this SSR-safe adapter no-ops on the server and
// reads/writes real localStorage once mounted in the browser.
const ssrSafeStorage = {
  getItem: (key: string) => (typeof window !== "undefined" ? window.localStorage.getItem(key) : null),
  setItem: (key: string, value: string) => {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  },
};

export function RoomShell({ room }: RoomShellProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "mosaic-room-layout",
    panelIds: ["chat", "graph", "artifacts"],
    storage: ssrSafeStorage,
  });

  const chatRef = usePanelRef();
  const graphRef = usePanelRef();
  const artifactsRef = usePanelRef();

  // The saved layout lives in localStorage, which is unavailable during SSR. To
  // avoid a hydration mismatch on the panels' inline sizes, the server and the
  // first client render both use the default layout (identical markup); once
  // hydrated, `mounted` becomes true, which both applies the stored
  // `defaultLayout` and changes the group's key so it remounts at those sizes.
  // useSyncExternalStore is the hydration-safe way to read "are we on the client
  // yet" without a setState-in-effect: it returns the server snapshot (false)
  // during SSR and the hydration render, then the client snapshot (true).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  const [artifactsCollapsed, setArtifactsCollapsed] = useState(false);

  function toggle(ref: React.RefObject<PanelImperativeHandle | null>) {
    const panel = ref.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }

  return (
    <RoomSocketProvider roomId={room.id}>
      <div className="flex h-screen flex-col bg-background">
        <header className="flex items-center gap-3 border-b border-border/70 bg-card px-4 py-2.5">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            title="Back to dashboard"
          >
            <ArrowLeft className="size-4" />
            <BrandMark className="size-4 text-foreground" />
          </Link>
          <div className="h-5 w-px bg-border" />
          <RoomTitle roomId={room.id} initialName={room.name} joinCode={room.join_code} />


          <div className="ml-2 flex items-center gap-1 rounded-lg bg-muted/50 p-0.5">
            <Button
              type="button"
              variant={chatCollapsed ? "outline" : "secondary"}
              size="icon-sm"
              onClick={() => toggle(chatRef)}
              title="Toggle chat"
            >
              <MessageSquare />
            </Button>
            <Button
              type="button"
              variant={graphCollapsed ? "outline" : "secondary"}
              size="icon-sm"
              onClick={() => toggle(graphRef)}
              title="Toggle visualization"
            >
              <Network />
            </Button>
            <Button
              type="button"
              variant={artifactsCollapsed ? "outline" : "secondary"}
              size="icon-sm"
              onClick={() => toggle(artifactsRef)}
              title="Toggle moodboard"
            >
              <Pin />
            </Button>
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <PresenceBar />
            <RoomStatus initialTokens={room.total_tokens_used} />
            <div className="flex items-center gap-1 border-l border-border pl-2">
              <AgentsDialog roomId={room.id} />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <ResizablePanelGroup
          key={mounted ? "ready" : "ssr"}
          orientation="horizontal"
          defaultLayout={mounted ? defaultLayout : undefined}
          onLayoutChanged={onLayoutChanged}
          className="min-h-0 flex-1"
        >
          <ResizablePanel
            id="chat"
            panelRef={chatRef}
            defaultSize={28}
            minSize={20}
            collapsible
            collapsedSize={0}
            onResize={() => setChatCollapsed(chatRef.current?.isCollapsed() ?? false)}
          >
            <ChatPane roomId={room.id} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="graph"
            panelRef={graphRef}
            defaultSize={44}
            minSize={20}
            collapsible
            collapsedSize={0}
            onResize={() => setGraphCollapsed(graphRef.current?.isCollapsed() ?? false)}
          >
            <VizPane roomId={room.id} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="artifacts"
            panelRef={artifactsRef}
            defaultSize={28}
            minSize={20}
            collapsible
            collapsedSize={0}
            onResize={() => setArtifactsCollapsed(artifactsRef.current?.isCollapsed() ?? false)}
          >
            <ArtifactsPane roomId={room.id} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </RoomSocketProvider>
  );
}
