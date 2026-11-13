// Add or edit a lead in a dialog, used by the CRM list and board. The fields
// themselves are LeadFields, shared with the cards on a lead's own page.

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
import { useTranslation } from "@/i18n";
import { type CrmConfig, crmApi, isClosed, type Lead } from "./api";
import { ALL_FIELDS, formToInput, LeadFields, type LeadForm, leadToForm } from "./LeadFields";

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
  // New leads start in the first stage; its follow-up action (if any) runs on save.
  const firstStage = stages.find((s) => !isClosed(s)) ?? stages[0] ?? "new";
  const [form, setForm] = useState<LeadForm>(() => leadToForm(lead, firstStage));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(leadToForm(lead, firstStage));
  }, [open, lead, firstStage]);

  const save = async () => {
    const input = formToInput(form, ALL_FIELDS);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? t("crm.edit_lead") : t("crm.add_lead")}</DialogTitle>
        </DialogHeader>
        {lead?.customer_id && (
          <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
            {t("crm.shared_with_customer")}
          </p>
        )}
        <LeadFields
          form={form}
          onChange={setForm}
          config={config}
          lead={lead}
          stages={stages}
          fields={ALL_FIELDS}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !form.name.trim()}>
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
