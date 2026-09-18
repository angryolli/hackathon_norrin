import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { ChatView } from "@/components/chat-view";

export default function Page() {
  return (
    <AppShell>
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading chat…</p>}>
        <ChatView />
      </Suspense>
    </AppShell>
  );
}
