"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { isValidRoomCode } from "@/lib/shared/roomCode";
import type { Role } from "@/lib/shared/protocol";
import { PhotoboothSession } from "./PhotoboothSession";

export function RoomClient({ code }: { code: string }) {
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    // sessionStorage only exists in the browser, so this can't be read
    // during the server-rendered pass — it has to sync in post-mount.
    const stored = sessionStorage.getItem(`spb-role-${code}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRole(stored === "host" ? "host" : "guest");
  }, [code]);

  if (!isValidRoomCode(code)) {
    return (
      <Center>
        <h1 className="text-2xl font-bold">That code doesn&rsquo;t look right</h1>
        <p className="mt-2 opacity-70">Double-check the 5-character code your partner sent you.</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-accent px-6 py-3 font-medium text-white">
          Back home
        </Link>
      </Center>
    );
  }

  if (!role) return null; // one tick, avoids a flash of the wrong role's UI

  return <PhotoboothSession code={code} role={role} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  );
}
