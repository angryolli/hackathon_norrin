import { TopBar } from "@/components/top-bar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <TopBar />
      <div className="flex-1">{children}</div>
    </div>
  );
}
