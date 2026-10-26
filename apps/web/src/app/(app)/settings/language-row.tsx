"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SettingRow } from "@/components/setting-row";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useI18n } from "@/lib/i18n/provider";
import { LOCALE_NAMES, LOCALES, type AppLocale } from "@/lib/i18n/translate";
import { errorMessage } from "@/lib/store/api";
import { useUpdateUserPreferencesMutation, useUserPreferencesQuery } from "@/lib/store/api/notifications";

const AUTO = "auto";

/** Settings › Profile › Language: the dashboard's language, or "follow the browser". Saved to the account. */
export function LanguageRow() {
  const { t } = useI18n();
  const router = useRouter();
  const prefs = useUserPreferencesQuery(undefined);
  const [update, { isLoading }] = useUpdateUserPreferencesMutation();
  const saved = prefs.data?.preferences.locale ?? AUTO;
  const items = [
    { value: AUTO, label: t("language.auto") },
    ...LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] })),
  ];

  const change = async (value: string | null) => {
    if (!value || value === saved) return;
    try {
      await update({ locale: value === AUTO ? null : (value as AppLocale) }).unwrap();
      // The page is rendered on the server in the chosen language: ask for it again.
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e, t("language.saveFailed")));
    }
  };

  return (
    <SettingRow label={t("language.label")} htmlFor="language-picker" description={t("language.description")}>
      <Select items={items} value={saved} onValueChange={(v) => void change(v)} disabled={isLoading}>
        <SelectTrigger id="language-picker" size="sm" className="w-56" aria-label={t("language.label")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}
