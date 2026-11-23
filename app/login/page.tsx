import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Entrar · Equipo de agentes" };

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-12">
      <h1 className="text-2xl font-semibold text-zinc-900">Entrar</h1>
      <p className="mt-1 mb-6 text-sm text-zinc-600">
        Con el usuario de prueba puedes lanzar peticiones nuevas. Sin cuenta puedes ver la{" "}
        <Link href="/" className="text-sky-700 hover:underline">
          ejecución de ejemplo
        </Link>
        .
      </p>
      <LoginForm />
    </main>
  );
}
