// The navigation chrome shared by the wide sidebar and the narrow sheet: the
// wordmark, the five destinations, and at the foot the signed-in Learner and Log out.
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { T } from "../components/Text.tsx";
import { useSession } from "../session/session.tsx";
import { NavList } from "./NavList.tsx";
import { Wordmark } from "./Wordmark.tsx";

export function SideNavContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="flex flex-col gap-6 p-4">
        <div className="flex items-baseline gap-2 py-2">
          <Wordmark className="text-display" />
          <span className="text-small font-semibold text-muted-foreground"><T k="brand.app" /></span>
        </div>
        <NavList onNavigate={onNavigate} />
      </div>
      <div className="mt-auto flex flex-col gap-2 p-4">
        <Separator className="mb-2" />
        <AccountFooter />
      </div>
    </>
  );
}

function AccountFooter() {
  // Logging out is the session's job: the guard sends the Learner to /login (see
  // RequireSession), so this button does not navigate itself.
  const { state, logout } = useSession();
  const username = state.status === "signedIn" ? state.user.username : "";

  return (
    <>
      <p className="text-small text-muted-foreground">
        <T k="shell.signedInAs" /> <span className="font-semibold text-foreground">{username}</span>
      </p>
      <Button variant="ghost" className="justify-start px-2 text-destructive hover:text-destructive" onClick={() => void logout()}>
        <LogOut aria-hidden="true" />
        <T k="shell.logOut" />
      </Button>
    </>
  );
}
