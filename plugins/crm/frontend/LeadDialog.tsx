// Add or edit a lead: contact details, source, value, stage, next follow-up
// and notes. Used by the CRM list, the board and a lead's own page.

import { Building2, User } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { type CrmConfig, crmApi, isClosed, type Lead, type LeadInput } from "./api";
import { useLeadLabels } from "./config";

export function LeadDialog({
  open,
  lead,
  config,
  stages,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  lead: Lead | null;
  config: CrmConfig;
  stages: string[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { stageLabel, sourceLabel } = useLeadLabels(config);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // New leads start in the first stage; its follow-up action (if any) runs on save.
  const firstStage = stages.find((s) => !isClosed(s)) ?? stages[0] ?? "new";
  // The lead's own source stays selectable even if it was removed from the list.
  const sources =
    lead?.source && !config.sources.includes(lead.source)
      ? [...config.sources, lead.source]
      : config.sources;

  useEffect(() => {
    if (!open) return;
    setForm({
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
    });
  }, [open, lead, firstStage]);

  const set = (key: string) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    const individual = form.lead_type === "individual";
    const input: LeadInput = {
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
    setSaving(true);
    try {
      if (lead) await crmApi.update(lead.id, input);
      else await crmApi.create(input);
      toast.success(t("crm.saved"));
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const text = (key: string, label: string, type = "text") => (
    <div className="space-y-1">
      <Label htmlFor={`lead-${key}`}>{label}</Label>
      <Input
        id={`lead-${key}`}
        type={type}
        value={form[key] ?? ""}
        onChange={(e) => set(key)(e.target.value)}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? t("crm.edit_lead") : t("crm.add_lead")}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Same control and words as the customer form, so a lead's type
              carries straight over when it becomes a customer. */}
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
          {text("name", t("crm.field_name"))}
          {form.lead_type !== "individual" && text("company", t("crm.field_company"))}
          {text("email", t("crm.field_email"), "email")}
          {text("phone", t("crm.field_phone"), "tel")}
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
          {text("value", t("crm.field_value"), "number")}
          <div className="space-y-1">
            <Label>{t("crm.field_stage")}</Label>
            <Select value={form.stage || firstStage} onValueChange={(v) => v && set("stage")(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>{stageLabel(form.stage || firstStage)}</SelectValue>
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
          {text("next_follow_up", t("crm.field_follow_up"), "date")}
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="lead-notes">{t("crm.field_notes")}</Label>
            <Textarea
              id="lead-notes"
              rows={3}
              value={form.notes ?? ""}
              onChange={(e) => set("notes")(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !form.name?.trim()}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
