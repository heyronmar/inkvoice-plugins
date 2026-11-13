// The lead form's fields, shared by the add/edit dialog (all fields) and the
// cards on a lead's page (each card edits its own fields in place).

import { Building2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import type { CrmConfig, Lead, LeadInput } from "./api";
import { useLeadLabels } from "./config";

export type LeadField =
  | "lead_type"
  | "name"
  | "company"
  | "email"
  | "phone"
  | "source"
  | "value"
  | "stage"
  | "next_follow_up"
  | "notes";

export const ALL_FIELDS: LeadField[] = [
  "lead_type",
  "name",
  "company",
  "email",
  "phone",
  "source",
  "value",
  "stage",
  "next_follow_up",
  "notes",
];

/** Form values are strings while editing. */
export type LeadForm = Record<LeadField, string>;

export function leadToForm(lead: Lead | null, firstStage: string): LeadForm {
  return {
    // New leads start as a company, the same default as a new customer.
    lead_type: lead?.lead_type ?? "company",
    name: lead?.name ?? "",
    company: lead?.company ?? "",
    email: lead?.email ?? "",
    phone: lead?.phone ?? "",
    source: lead?.source ?? "",
    value: lead?.value != null ? String(lead.value) : "",
    stage: lead?.stage ?? firstStage,
    next_follow_up: lead?.next_follow_up ?? "",
    notes: lead?.notes ?? "",
  };
}

/** What to send for the given fields only, so a card never overwrites the others. */
export function formToInput(form: LeadForm, fields: LeadField[]): LeadInput {
  const individual = form.lead_type === "individual";
  const all: LeadInput = {
    lead_type: individual ? "individual" : "company",
    name: form.name.trim(),
    // A person has no company; don't keep one typed before switching.
    company: individual ? null : form.company,
    email: form.email.trim(),
    phone: form.phone,
    source: form.source || null,
    value: form.value === "" ? null : Number(form.value),
    stage: form.stage,
    next_follow_up: form.next_follow_up || null,
    notes: form.notes,
  };
  const input: LeadInput = {};
  for (const f of fields) (input as Record<string, unknown>)[f] = all[f];
  // The company goes with the type, so switching to individual clears it.
  if (fields.includes("lead_type")) input.company = all.company;
  return input;
}

export function LeadFields({
  form,
  onChange,
  config,
  lead,
  stages,
  fields,
  className,
  hideLabels = false,
}: {
  form: LeadForm;
  onChange: (form: LeadForm) => void;
  config: CrmConfig;
  lead: Lead | null;
  stages: string[];
  fields: LeadField[];
  className?: string;
  /** When the card's title already names the field; labels stay for screen readers. */
  hideLabels?: boolean;
}) {
  const { t } = useTranslation();
  const { stageLabel, sourceLabel } = useLeadLabels(config);
  const set = (key: LeadField) => (value: string) => onChange({ ...form, [key]: value });
  const show = (f: LeadField) => fields.includes(f);
  // The lead's own source stays selectable even if it was removed from the list.
  const sources =
    lead?.source && !config.sources.includes(lead.source)
      ? [...config.sources, lead.source]
      : config.sources;

  const text = (key: LeadField, label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={`lead-${key}`} className={cn(hideLabels && "sr-only")}>
        {label}
      </Label>
      <Input
        id={`lead-${key}`}
        type={type}
        value={form[key] ?? ""}
        onChange={(e) => set(key)(e.target.value)}
      />
    </div>
  );

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      {show("lead_type") && (
        // Same control and words as the customer form, so a lead's type
        // carries straight over when it becomes a customer.
        <div className="space-y-1 sm:col-span-2">
          <Label>{t("customers.type")}</Label>
          <div className="inline-flex h-8 w-fit items-center gap-0.5 rounded-lg border p-0.5">
            {(
              [
                ["company", Building2, t("customers.type_company")],
                ["individual", User, t("customers.type_individual")],
              ] as const
            ).map(([value, Icon, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={form.lead_type === value ? "secondary" : "ghost"}
                className="h-full"
                aria-pressed={form.lead_type === value}
                onClick={() => set("lead_type")(value)}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}
      {show("name") && text("name", t("crm.field_name"))}
      {show("company") &&
        form.lead_type !== "individual" &&
        text("company", t("crm.field_company"))}
      {show("email") && text("email", t("crm.field_email"), "email")}
      {show("phone") && text("phone", t("crm.field_phone"), "tel")}
      {show("source") && (
        <div className="space-y-1">
          <Label>{t("crm.field_source")}</Label>
          <Select
            value={form.source || "none"}
            onValueChange={(v) => set("source")(v === "none" || !v ? "" : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {form.source ? sourceLabel(form.source) : t("crm.no_source")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("crm.no_source")}</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s} value={s}>
                  {sourceLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {show("value") && text("value", t("crm.field_value"), "number")}
      {show("stage") && (
        <div className="space-y-1">
          <Label className={cn(hideLabels && "sr-only")}>{t("crm.field_stage")}</Label>
          <Select value={form.stage} onValueChange={(v) => v && set("stage")(v)}>
            <SelectTrigger className="w-full">
              <SelectValue>{stageLabel(form.stage)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(stages.includes(form.stage) ? stages : [...stages, form.stage]).map((s) => (
                <SelectItem key={s} value={s}>
                  {stageLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {show("next_follow_up") && text("next_follow_up", t("crm.field_follow_up"), "date")}
      {show("notes") && (
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="lead-notes" className={cn(hideLabels && "sr-only")}>
            {t("crm.field_notes")}
          </Label>
          <Textarea
            id="lead-notes"
            rows={4}
            value={form.notes ?? ""}
            onChange={(e) => set("notes")(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
