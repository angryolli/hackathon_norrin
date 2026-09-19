import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { ChatView } from "@/components/chat-view";

export default function Page() {
  return (
    <AppShell>
      <div className="h-full min-h-0">
        <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading agent…</p>}>
          <ChatView />
        </Suspense>
      </div>
    </AppShell>
  );
}
