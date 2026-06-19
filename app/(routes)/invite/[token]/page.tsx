"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthUser } from "@/components/auth-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Logo from "@/components/logo";
import { toast } from "sonner";

export default function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const { isSignedIn, isLoading } = useAuthUser();
  const [accepting, setAccepting] = useState(false);

  // Se não estiver logado, manda para o login e volta para cá.
  useEffect(() => {
    if (!isLoading && !isSignedIn) {
      router.replace(`/sign-in?redirect=/invite/${token}`);
    }
  }, [isLoading, isSignedIn, router, token]);

  const handleAccept = async () => {
    setAccepting(true);
    const res = await fetch("/api/invitations/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setAccepting(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "Não foi possível aceitar o convite");
      return;
    }
    toast.success("Você entrou na organização!");
    router.push("/schedule");
    router.refresh();
  };

  if (isLoading || !isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3">
          <Logo />
          <div>
            <CardTitle className="text-xl">Convite de organização</CardTitle>
            <CardDescription>
              Você foi convidado para participar de uma organização no Flow Insta.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button className="w-full" onClick={handleAccept} disabled={accepting}>
            {accepting ? "Entrando..." : "Aceitar convite"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
