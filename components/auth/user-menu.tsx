import Link from "next/link";
import { signOut } from "@/app/login/actions";
import { currentUser } from "@/lib/server/auth";

/** Header session area; reads cookies, so it renders behind a Suspense boundary. */
export async function UserMenu() {
  const user = await currentUser();
  if (!user) {
    return (
      <Link href="/login" className="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100">
        Entrar
      </Link>
    );
  }
  return (
    <form action={signOut} className="flex items-center gap-3 text-sm">
      <span className="hidden text-zinc-500 sm:inline">{user.email}</span>
      <button type="submit" className="rounded-md px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100">
        Salir
      </button>
    </form>
  );
}
