"use client";

import { Link2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { ButtonLink } from "@/components/button-link";
import { FormError } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";
import { useClaimSlackLinkMutation } from "@/lib/store/api/slack";

/** The Slack user a link token names, read from its (unsigned) body for display; the server verifies the token. */
function slackUserOf(token: string): string | null {
  try {
    const body = token.split(".")[0] ?? "";
    const text = atob(body.replaceAll("-", "+").replaceAll("_", "/"));
    return /^[0-9a-f-]{36}\.([A-Z0-9]{9,15})\.\d+$/i.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * "Link my account", opened from a Slack message. Linking is explicit: an attacker could send someone a link
 * for the attacker's own Slack user, so nothing happens until the signed-in member presses the button.
 */
export function SlackLink() {
  const t = useT();
  const token = useSearchParams().get("token") ?? "";
  const user = slackUserOf(token);
  const [claim, { isLoading }] = useClaimSlackLinkMutation();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  return (
    <div className="mx-auto w-full max-w-lg p-4 sm:p-8">
      <Card data-testid="slack-link">
        <CardHeader>
          <CardTitle>{t("slack.linkTitle")}</CardTitle>
          <CardDescription>{t("slack.linkDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {!user && <FormError message={t("slack.linkMissing")} />}
          {user && !done && (
            <>
              <p className="text-sm">{t("slack.linkBody", { user })}</p>
              <p className="text-sm font-medium">{t("slack.linkWarning")}</p>
              <FormError message={error} />
              <div>
                <Button
                  disabled={isLoading}
                  onClick={() =>
                    void claim(token)
                      .unwrap()
                      .then((r) => setDone(r.teamName))
                      .catch((e: unknown) => setError(errorMessage(e)))
                  }
                >
                  <Link2 /> {isLoading ? t("slack.linking") : t("slack.linkConfirm")}
                </Button>
              </div>
            </>
          )}
          {done && (
            <p role="status" className="text-sm">
              {t("slack.linkDone", { team: done })}
            </p>
          )}
          <div>
            <ButtonLink href="/inbox" variant="ghost" size="sm">
              {t("slack.linkBack")}
            </ButtonLink>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
