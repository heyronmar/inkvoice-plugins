// Add or edit a lead in a dialog, used by the CRM list and board. The fields
// themselves are LeadFields, shared with the cards on a lead's own page.

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { CustomerCombobox } from "@/components/shared/CustomerCombobox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { type CrmConfig, crmApi, isClosed, type Lead } from "./api";
import { useCrmTranslation } from "./config";
import {
  ALL_FIELDS,
  formToInput,
  type LeadField,
  LeadFields,
  type LeadForm,
  leadToForm,
} from "./LeadFields";

interface CustomerOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  customer_type: "company" | "individual";
}

/** Details a lead takes from an existing customer, so they aren't asked for. */
const FROM_CUSTOMER: LeadField[] = ["lead_type", "company", "email", "phone"];

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
  const { t } = useCrmTranslation();
  // New leads start in the first stage; its follow-up action (if any) runs on save.
  const firstStage = stages.find((s) => !isClosed(s)) ?? stages[0] ?? "new";
  const [form, setForm] = useState<LeadForm>(() => leadToForm(lead, firstStage));
  const [saving, setSaving] = useState(false);
  // New leads can be for a customer that already exists (a returning customer).
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const customer = customers.find((c) => c.id === customerId);

  useEffect(() => {
    if (!open) return;
    setForm(leadToForm(lead, firstStage));
    setCustomerId("");
    if (!lead && customers.length === 0) {
      api
        .listCustomers({ limit: "1000" })
        .then((r) => setCustomers(r.data.items))
        .catch(() => {});
    }
    // customers only load once per page.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  }, [open, lead, firstStage]);

  const pickCustomer = (id: string) => {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (!c) return;
    // Their details come from the customer; the contact person defaults to it.
    setForm((f) => ({
      ...f,
      lead_type: c.customer_type,
      company: c.customer_type === "company" ? c.name : "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      name: f.name.trim() ? f.name : c.name,
    }));
  };

  const fields = customer ? ALL_FIELDS.filter((f) => !FROM_CUSTOMER.includes(f)) : ALL_FIELDS;

  const save = async () => {
    const input = formToInput(form, ALL_FIELDS);
    if (customer) input.customer_id = customer.id;
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
        {!lead && (
          <div className="space-y-1">
            <Label>{t("crm.field_customer")}</Label>
            <CustomerCombobox customers={customers} value={customerId} onChange={pickCustomer} />
            <p className="text-xs text-muted-foreground">
              {customer ? (
                <>
                  {t("crm.customer_details_from", { name: customer.name })}{" "}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => {
                      setCustomerId("");
                      setForm(leadToForm(null, firstStage));
                    }}
                  >
                    {t("crm.customer_new_instead")}
                  </button>
                </>
              ) : (
                t("crm.customer_new_hint")
              )}
            </p>
          </div>
        )}
        <LeadFields
          form={form}
          onChange={setForm}
          config={config}
          lead={lead}
          stages={stages}
          fields={fields}
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
