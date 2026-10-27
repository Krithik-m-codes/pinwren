"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { SettingGroup, SettingRow } from "@/components/setting-row";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { OrgAiSettings } from "@/lib/api";
import type { Key } from "@/lib/i18n/en";
import { useI18n } from "@/lib/i18n/provider";
import { errorMessage } from "@/lib/store/api";

const schema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["anthropic", "openai", "ollama"]),
  model: z.string().min(1, "settings1.modelNameRequired"),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const MODEL_PRESETS: Record<"anthropic" | "openai" | "ollama", { defaultModel: string; presets: string[] }> =
  {
    anthropic: {
      defaultModel: "claude-haiku-5-5",
      presets: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
    },
    openai: {
      defaultModel: "gpt-4o-mini",
      presets: ["gpt-4o-mini", "gpt-4o"],
    },
    ollama: {
      defaultModel: "llama3.2",
      presets: ["llama3.2", "mistral", "qwen2.5"],
    },
  };

export type AiSettingsPayload = Partial<OrgAiSettings> & { apiKey?: string | undefined };

export function AiSettingsForm({
  initialConfig,
  onSave,
  onTest,
}: {
  initialConfig?: Partial<OrgAiSettings> | undefined;
  onSave?: ((values: AiSettingsPayload) => Promise<void>) | undefined;
  onTest?:
    | ((
        values: AiSettingsPayload,
      ) => Promise<{ ok: boolean; latencyMs?: number | undefined; error?: string | undefined }>)
    | undefined;
}) {
  const { t } = useI18n();
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(!initialConfig?.hasKey);

  const defaultProvider = initialConfig?.provider ?? "anthropic";
  const defaultModel = initialConfig?.model ?? MODEL_PRESETS[defaultProvider].defaultModel;

  const [selectedProvider, setSelectedProvider] = useState<"anthropic" | "openai" | "ollama">(
    defaultProvider,
  );
  const [isEnabled, setIsEnabled] = useState(initialConfig?.enabled ?? false);

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      enabled: initialConfig?.enabled ?? false,
      provider: defaultProvider,
      model: defaultModel,
      apiKey: "",
      baseUrl: initialConfig?.baseUrl ?? (defaultProvider === "ollama" ? "http://localhost:11434" : ""),
    },
  });

  const onProviderChange = (provider: "anthropic" | "openai" | "ollama") => {
    setSelectedProvider(provider);
    setValue("provider", provider);
    setValue("model", MODEL_PRESETS[provider].defaultModel);
    if (provider === "ollama") {
      setValue("baseUrl", "http://localhost:11434");
    } else if (getValues("baseUrl") === "http://localhost:11434") {
      setValue("baseUrl", "");
    }
  };

  const onSubmit = async (values: FormValues) => {
    setIsSaving(true);
    try {
      const payload: AiSettingsPayload = {
        enabled: isEnabled,
        provider: selectedProvider,
        model: values.model.trim(),
        baseUrl: values.baseUrl?.trim() || undefined,
      };
      if (values.apiKey?.trim()) {
        payload.apiKey = values.apiKey.trim();
      }

      if (onSave) {
        await onSave(payload);
      }
      toast.success(t("settings1.aiSettingsUpdated"));
      if (payload.apiKey) {
        setShowKeyInput(false);
      }
    } catch (e: unknown) {
      toast.error(t("settings1.aiSettingsUpdateFailed"), { description: errorMessage(e) });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    const values = getValues();
    setIsTesting(true);
    try {
      if (onTest) {
        const res = await onTest({
          provider: selectedProvider,
          model: values.model.trim(),
          apiKey: values.apiKey?.trim() || undefined,
          baseUrl: values.baseUrl?.trim() || undefined,
        });

        if (res.ok) {
          toast.success(
            res.latencyMs
              ? t("settings1.connectionSuccessfulMs", { ms: res.latencyMs })
              : t("settings1.connectionSuccessful"),
          );
        } else {
          toast.error(t("settings1.connectionFailed"), {
            description: res.error || t("settings1.unknownError"),
          });
        }
      }
    } catch (e: unknown) {
      toast.error(t("settings1.connectionTestError"), { description: errorMessage(e) });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings1.providerAndModel")}</CardTitle>
          <CardDescription>{t("settings1.providerAndModelDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow
              label={t("settings1.enableAiFeatures")}
              description={t("settings1.enableAiFeaturesDescription")}
            >
              <Switch
                checked={isEnabled}
                onCheckedChange={(checked) => {
                  setIsEnabled(checked);
                  setValue("enabled", checked);
                }}
                aria-label={t("settings1.enableAiFeatures")}
              />
            </SettingRow>

            <SettingRow
              label={t("settings1.provider")}
              description={t("settings1.providerDescription")}
              stack
            >
              <div className="grid gap-3 pt-1 sm:grid-cols-3">
                {(
                  [
                    {
                      id: "anthropic",
                      label: "settings1.providerAnthropic",
                      desc: "settings1.providerAnthropicDesc",
                    },
                    {
                      id: "openai",
                      label: "settings1.providerOpenai",
                      desc: "settings1.providerOpenaiDesc",
                    },
                    {
                      id: "ollama",
                      label: "settings1.providerOllama",
                      desc: "settings1.providerOllamaDesc",
                    },
                  ] as const satisfies readonly { id: string; label: Key; desc: Key }[]
                ).map((opt) => {
                  const active = selectedProvider === opt.id;
                  return (
                    <label
                      key={opt.id}
                      className={`relative flex cursor-pointer flex-col rounded-lg border p-3.5 transition-colors focus-within:ring-2 focus-within:ring-ring ${
                        active
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="provider"
                          value={opt.id}
                          checked={active}
                          onChange={() => onProviderChange(opt.id)}
                          className="size-4 text-primary focus:ring-ring"
                        />
                        <span className="text-sm font-semibold">{t(opt.label)}</span>
                      </div>
                      <span className="mt-1 text-xs text-muted-foreground">{t(opt.desc)}</span>
                    </label>
                  );
                })}
              </div>
            </SettingRow>

            <SettingRow
              label={t("settings1.model")}
              htmlFor="ai-model"
              description={t("settings1.modelDescription")}
            >
              <div className="w-full space-y-2 sm:w-80">
                <Input
                  id="ai-model"
                  {...register("model")}
                  placeholder={MODEL_PRESETS[selectedProvider].defaultModel}
                />
                {errors.model && <p className="text-xs text-destructive">{t(errors.model.message as Key)}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {MODEL_PRESETS[selectedProvider].presets.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => setValue("model", preset)}
                    >
                      {preset}
                    </Button>
                  ))}
                </div>
              </div>
            </SettingRow>

            {selectedProvider !== "ollama" && (
              <SettingRow
                label={t("settings1.apiKey")}
                htmlFor="ai-api-key"
                description={t("settings1.apiKeyDescription")}
              >
                <div className="w-full space-y-2 sm:w-80">
                  {initialConfig?.hasKey && !showKeyInput ? (
                    <div className="flex items-center gap-2">
                      <span className="rounded-md border bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
                        ••••••••••••••••
                      </span>
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowKeyInput(true)}>
                        {t("settings1.changeKey")}
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Input id="ai-api-key" type="password" placeholder="sk-..." {...register("apiKey")} />
                      {initialConfig?.hasKey && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="text-xs text-muted-foreground"
                          onClick={() => {
                            setValue("apiKey", "");
                            setShowKeyInput(false);
                          }}
                        >
                          {t("settings1.keepExistingKey")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </SettingRow>
            )}

            {(selectedProvider === "openai" || selectedProvider === "ollama") && (
              <SettingRow
                label={t("settings1.baseUrl")}
                htmlFor="ai-base-url"
                description={
                  selectedProvider === "ollama"
                    ? t("settings1.baseUrlDescriptionOllama")
                    : t("settings1.baseUrlDescriptionOther")
                }
              >
                <div className="w-full sm:w-80">
                  <Input
                    id="ai-base-url"
                    type="url"
                    placeholder={
                      selectedProvider === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1"
                    }
                    {...register("baseUrl")}
                  />
                </div>
              </SettingRow>
            )}
          </SettingGroup>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={handleTestConnection}
          disabled={isTesting || isSaving}
        >
          {isTesting ? t("settings1.testingConnection") : t("settings1.testConnection")}
        </Button>
        <Button type="submit" disabled={isSaving || isTesting}>
          {isSaving ? t("settings1.saving") : t("settings1.saveChanges")}
        </Button>
      </div>
    </form>
  );
}
