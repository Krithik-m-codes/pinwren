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
import { errorMessage } from "@/lib/store/api";

const schema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["anthropic", "openai", "ollama"]),
  model: z.string().min(1, "Model name is required"),
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
      toast.success("AI settings updated successfully");
      if (payload.apiKey) {
        setShowKeyInput(false);
      }
    } catch (e: unknown) {
      toast.error("Failed to update AI settings", { description: errorMessage(e) });
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
            res.latencyMs ? `Connection successful (${res.latencyMs}ms)` : "Connection successful",
          );
        } else {
          toast.error("Connection failed", { description: res.error || "Unknown error" });
        }
      }
    } catch (e: unknown) {
      toast.error("Connection test error", { description: errorMessage(e) });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Provider & Model</CardTitle>
          <CardDescription>
            Choose the language model provider for automatic summaries, triage, and duplicate detection.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingGroup>
            <SettingRow
              label="Enable AI features"
              description="Allow AI assistance across projects where AI triage is toggled on."
            >
              <Switch
                checked={isEnabled}
                onCheckedChange={(checked) => {
                  setIsEnabled(checked);
                  setValue("enabled", checked);
                }}
                aria-label="Enable AI features"
              />
            </SettingRow>

            <SettingRow
              label="Provider"
              description="Pinwren supports Anthropic Claude, OpenAI-compatible APIs, and local Ollama."
              stack
            >
              <div className="grid gap-3 pt-1 sm:grid-cols-3">
                {(
                  [
                    { id: "anthropic", label: "Anthropic", desc: "Claude Haiku, Sonnet & Opus" },
                    { id: "openai", label: "OpenAI-compatible", desc: "OpenAI, Groq, OpenRouter" },
                    { id: "ollama", label: "Ollama (Local)", desc: "Self-hosted local models" },
                  ] as const
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
                        <span className="text-sm font-semibold">{opt.label}</span>
                      </div>
                      <span className="mt-1 text-xs text-muted-foreground">{opt.desc}</span>
                    </label>
                  );
                })}
              </div>
            </SettingRow>

            <SettingRow label="Model" htmlFor="ai-model" description="Model identifier sent in API requests.">
              <div className="w-full space-y-2 sm:w-80">
                <Input
                  id="ai-model"
                  {...register("model")}
                  placeholder={MODEL_PRESETS[selectedProvider].defaultModel}
                />
                {errors.model && <p className="text-xs text-destructive">{errors.model.message}</p>}
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
                label="API Key"
                htmlFor="ai-api-key"
                description="Encrypted at rest with AES-256-GCM. Never shown in plain text once saved."
              >
                <div className="w-full space-y-2 sm:w-80">
                  {initialConfig?.hasKey && !showKeyInput ? (
                    <div className="flex items-center gap-2">
                      <span className="rounded-md border bg-muted px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
                        ••••••••••••••••
                      </span>
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowKeyInput(true)}>
                        Change key
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
                          Keep existing key
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </SettingRow>
            )}

            {(selectedProvider === "openai" || selectedProvider === "ollama") && (
              <SettingRow
                label="Base URL"
                htmlFor="ai-base-url"
                description={
                  selectedProvider === "ollama"
                    ? "Address of your Ollama instance (default: http://localhost:11434)."
                    : "Custom endpoint URL if using Azure, Groq, OpenRouter, or a reverse proxy."
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
          {isTesting ? "Testing connection..." : "Test connection"}
        </Button>
        <Button type="submit" disabled={isSaving || isTesting}>
          {isSaving ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
