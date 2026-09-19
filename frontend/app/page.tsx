import { AppShell } from "@/components/app-shell";
import { DiagnosisView } from "@/components/diagnosis-view";

export default function Page() {
  return (
    <AppShell>
      <div className="h-full min-h-0">
        <DiagnosisView />
      </div>
    </AppShell>
  );
}
