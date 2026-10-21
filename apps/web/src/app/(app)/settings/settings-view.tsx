"use client";

import { useQuery } from "@tanstack/react-query";
import { initials } from "@/components/app-shell";
import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api, type Member } from "@/lib/api";
import { authClient, useSession } from "@/lib/auth-client";

export function SettingsView() {
  const { data: session } = useSession();
  const { data: org } = authClient.useActiveOrganization();
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<{ members: Member[] }>("/members") });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="mx-auto grid w-full max-w-3xl gap-4 p-4">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>How you appear to your team.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Avatar className="size-10">
              <AvatarFallback>{initials(session?.user.name)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{session?.user.name}</p>
              <p className="text-sm text-muted-foreground">{session?.user.email}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Workspace</CardTitle>
            <CardDescription>{org?.name}</CardDescription>
          </CardHeader>
          <CardContent>
            <h3 className="mb-2 text-sm font-medium">Members</h3>
            <ul className="divide-y rounded-lg border">
              {members.isPending && <Skeleton className="m-3 h-8" />}
              {members.data?.members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar className="size-7">
                    <AvatarFallback className="text-xs">{initials(m.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  <Badge variant="outline" className="capitalize">
                    {m.role}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
