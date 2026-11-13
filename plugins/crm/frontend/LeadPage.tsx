// A lead's own page (/crm/leads/:id), opened by clicking a lead on the CRM
// list or board. Laid out for richer lead data to come:
//  - header: who it is, its stage, and what to do next (quote, customer…)
//  - each card edits its own fields in place (✏️), with the dialog's fields
//  - main column: details, notes, activity history
//  - side column: pipeline position, next follow-up, linked records
// New sections slot into one of the two columns as their own components.

import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Clock,
  FilePlus,
  FileText,
  Pencil,
  Plus,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Hint, TooltipProvider } from "@/components/ui/tooltip";
import { useCan } from "@/hooks/use-can";
import { useTranslation } from "@/i18n";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings.store";
import { type Activity, type CrmConfig, crmApi, isClosed, type Lead, type LeadInput } from "./api";
import { stageStyle, useCrmConfig, useLeadLabels } from "./config";

import { formToInput, type LeadField, LeadFields, type LeadForm, leadToForm } from "./LeadFields";
import { LeadTypeIcon } from "./LeadTypeIcon";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function LeadPage() {
  const { id = "" } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const can = useCan();
  const canCreate = can("customers", "create");
  const canEdit = can("customers", "update");
  const canDelete = can("customers", "delete");
  const canQuote = canCreate && can("invoices", "create");
  const settings = useSettingsStore((s) => s.settings);
  const currency = settings.base_currency || settings.currency || "USD";
  const { config } = useCrmConfig();
  const { stageLabel, sourceLabel } = useLeadLabels(config);

  const [lead, setLead] = useState<Lead | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [missing, setMissing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, a] = await Promise.all([crmApi.get(id), crmApi.activity(id)]);
      setLead(l.data);
      setActivity(a.data);
    } catch {
      setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, success?: string): Promise<boolean> => {
    try {
      await action();
      if (success) toast.success(success);
      await load();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    }
  };

  if (missing) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-muted-foreground">{t("crm.lead_not_found")}</p>
      </div>
    );
  }
  if (!lead) return null;

  const closed = isClosed(lead.stage);
  const today = localToday();
  const overdue = !!lead.next_follow_up && !closed && lead.next_follow_up < today;
  // Stages to pick from: the visible ones, plus the lead's own if it's hidden.
  const stages = config.stages.filter((s) => !s.hidden || s.id === lead.stage).map((s) => s.id);

  // What every editable card needs: each one saves only its own fields.
  const edit = {
    lead,
    config,
    stages,
    editable: canEdit,
    onSave: (input: LeadInput) => run(() => crmApi.update(lead.id, input), t("crm.saved")),
  };

  const createQuote = async () => {
    try {
      const res = await crmApi.startQuote(lead.id);
      navigate(`/quotes/new?customer_id=${res.data.customer_id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <BackLink />

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <LeadTypeIcon type={lead.lead_type} className="h-5 w-5" />
              <h1 className="text-2xl font-bold tracking-tight">{lead.name}</h1>
              <Badge className={stageStyle(config, lead.stage)}>{stageLabel(lead.stage)}</Badge>
              {overdue && <Badge variant="destructive">{t("crm.overdue")}</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
              {lead.company && <span>{lead.company}</span>}
              {lead.value != null && (
                <span className="tabular-nums">{formatCurrency(lead.value, currency)}</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {lead.quote_id && lead.quote_number ? (
              <Button variant="outline" onClick={() => navigate(`/quotes/${lead.quote_id}`)}>
                <FileText className="h-4 w-4" />
                {t("crm.open_quote", { number: lead.quote_number })}
              </Button>
            ) : (
              canQuote &&
              !closed && (
                <Button variant="outline" onClick={createQuote}>
                  <FilePlus className="h-4 w-4" /> {t("crm.create_quote")}
                </Button>
              )
            )}
            {lead.customer_id ? (
              <Button variant="outline" onClick={() => navigate(`/customers/${lead.customer_id}`)}>
                <Users className="h-4 w-4" /> {t("crm.view_customer")}
              </Button>
            ) : (
              canCreate &&
              lead.stage !== "lost" && (
                <Button
                  variant="outline"
                  onClick={() => run(() => crmApi.convert(lead.id), t("crm.converted"))}
                >
                  <UserPlus className="h-4 w-4" /> {t("crm.convert")}
                </Button>
              )
            )}
            {canDelete && (
              <Hint label={t("common.delete")}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("common.delete")}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </Hint>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Main column */}
          <div className="space-y-4 lg:col-span-2">
            <EditableSection
              {...edit}
              title={t("crm.section_details")}
              hint={lead.customer_id ? t("crm.shared_with_customer") : undefined}
              fields={["lead_type", "name", "company", "email", "phone", "source", "value"]}
            >
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Field label={t("customers.type")}>
                  {t(
                    lead.lead_type === "individual"
                      ? "customers.type_individual"
                      : "customers.type_company",
                  )}
                </Field>
                <Field label={t("crm.field_name")}>{lead.name}</Field>
                {lead.lead_type !== "individual" && (
                  <Field label={t("crm.field_company")}>{lead.company}</Field>
                )}
                <Field label={t("crm.field_email")}>
                  {lead.email && (
                    <a className="text-primary hover:underline" href={`mailto:${lead.email}`}>
                      {lead.email}
                    </a>
                  )}
                </Field>
                <Field label={t("crm.field_phone")}>
                  {lead.phone && (
                    <a className="text-primary hover:underline" href={`tel:${lead.phone}`}>
                      {lead.phone}
                    </a>
                  )}
                </Field>
                <Field label={t("crm.field_source")}>
                  {lead.source && sourceLabel(lead.source)}
                </Field>
                <Field label={t("crm.field_value")}>
                  {lead.value != null && formatCurrency(lead.value, currency)}
                </Field>
                <Field label={t("crm.field_added")}>
                  {formatDate(lead.created_at.slice(0, 10))}
                </Field>
              </dl>
            </EditableSection>

            <EditableSection {...edit} title={t("crm.field_notes")} fields={["notes"]}>
              {lead.notes ? (
                <p className="whitespace-pre-wrap text-sm">{lead.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("crm.no_notes")}</p>
              )}
            </EditableSection>

            <Section title={t("crm.section_activity")}>
              <ActivityTimeline items={activity} lead={lead} config={config} />
            </Section>
          </div>

          {/* Side column */}
          <div className="space-y-4">
            <EditableSection {...edit} title={t("crm.section_pipeline")} fields={["stage"]}>
              <ol className="space-y-1.5">
                {stages.map((s, i) => {
                  const at = stages.indexOf(lead.stage);
                  const state = s === lead.stage ? "current" : i < at && !closed ? "done" : "todo";
                  return (
                    <li key={s} className="flex items-center gap-2 text-sm">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          state === "current" && "bg-primary ring-4 ring-primary/15",
                          state === "done" && "bg-primary/50",
                          state === "todo" && "bg-muted-foreground/25",
                        )}
                      />
                      <span
                        className={cn(
                          state === "current" ? "font-medium" : "text-muted-foreground",
                        )}
                      >
                        {stageLabel(s)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </EditableSection>

            <EditableSection
              {...edit}
              editable={canEdit && !closed}
              title={t("crm.field_follow_up")}
              fields={["next_follow_up"]}
            >
              <p className="text-sm">
                {lead.next_follow_up ? formatDate(lead.next_follow_up) : t("crm.none")}
              </p>
              {overdue && <p className="text-xs text-destructive">{t("crm.follow_up_overdue")}</p>}
            </EditableSection>

            <Section title={t("crm.section_linked")}>
              <LinkRow
                icon={<Users className="h-4 w-4" />}
                label={t("crm.linked_customer")}
                to={lead.customer_id ? `/customers/${lead.customer_id}` : undefined}
                value={lead.customer_id ? t("crm.view_customer") : t("crm.linked_none")}
              />
              {lead.customer_id && canEdit && (
                // The app's own customer form (address, tax…), coming back here after saving.
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto px-0"
                  onClick={() =>
                    navigate(`/customers/${lead.customer_id}/edit`, {
                      state: { returnTo: `/crm/leads/${lead.id}` },
                    })
                  }
                >
                  <Pencil className="h-3.5 w-3.5" /> {t("crm.edit_customer")}
                </Button>
              )}
              <LinkRow
                icon={<FileText className="h-4 w-4" />}
                label={t("crm.linked_quote")}
                to={lead.quote_id ? `/quotes/${lead.quote_id}` : undefined}
                value={
                  lead.quote_number
                    ? `${lead.quote_number}${lead.quote_status ? ` · ${t(`quotes.status_${lead.quote_status}`)}` : ""}`
                    : t("crm.linked_none")
                }
              />
              {lead.project_id && (
                <LinkRow
                  icon={<Clock className="h-4 w-4" />}
                  label={t("crm.linked_project")}
                  to="/time-tracking"
                  value={t("crm.linked_open")}
                />
              )}
            </Section>
          </div>
        </div>

        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t("crm.delete_title")}
          description={t("crm.delete_description")}
          confirmLabel={t("common.delete")}
          variant="destructive"
          onConfirm={async () => {
            try {
              await crmApi.remove(lead.id);
              toast.success(t("crm.deleted"));
              navigate("/crm");
            } catch (e) {
              toast.error((e as Error).message);
            }
          }}
        />
      </div>
    </TooltipProvider>
  );
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/crm"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" /> {t("crm.back_to_crm")}
    </Link>
  );
}

function Section({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {hint && <CardDescription>{hint}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

/**
 * A card with its own ✏️: editing swaps the view for the lead form's fields
 * (LeadFields, the same ones as the dialog) and saves only those fields.
 */
function EditableSection({
  title,
  hint,
  fields,
  lead,
  config,
  stages,
  editable,
  onSave,
  children,
}: {
  title: string;
  hint?: string;
  fields: LeadField[];
  lead: Lead;
  config: CrmConfig;
  stages: string[];
  editable: boolean;
  onSave: (input: LeadInput) => Promise<boolean>;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<LeadForm | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!form) return;
    setSaving(true);
    if (await onSave(formToInput(form, fields))) setForm(null);
    setSaving(false);
  };
  const invalid = !!form && fields.includes("name") && !form.name.trim();
  return (
    <Section
      title={title}
      hint={hint}
      action={
        editable && !form ? (
          <Hint label={t("common.edit")}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${t("common.edit")}: ${title}`}
              onClick={() => setForm(leadToForm(lead, lead.stage))}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </Hint>
        ) : undefined
      }
    >
      {form ? (
        <div className="space-y-3">
          <LeadFields
            form={form}
            onChange={setForm}
            config={config}
            lead={lead}
            stages={stages}
            fields={fields}
            className={fields.length === 1 ? "sm:grid-cols-1" : undefined}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button onClick={save} disabled={saving || invalid}>
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      ) : (
        children
      )}
    </Section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">
        {children || <span className="text-muted-foreground">-</span>}
      </dd>
    </div>
  );
}

function LinkRow({
  icon,
  label,
  value,
  to,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  to?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon} {label}
      </span>
      {to ? (
        <Link to={to} className="truncate text-primary hover:underline">
          {value}
        </Link>
      ) : (
        <span className="truncate text-muted-foreground">{value}</span>
      )}
    </div>
  );
}

const ACTIVITY_ICONS: Record<Activity["kind"], typeof Plus> = {
  created: Plus,
  stage_changed: ArrowRight,
  follow_up_set: CalendarClock,
  converted: UserCheck,
  quote_linked: FileText,
  project_created: Clock,
};

/** Local date and time for a stored UTC timestamp ("YYYY-MM-DD HH:MM:SS"). */
function when(ts: string): string {
  const d = new Date(`${ts.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return ts;
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${formatDate(date)} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function ActivityTimeline({
  items,
  lead,
  config,
}: {
  items: Activity[];
  lead: Lead;
  config: CrmConfig;
}) {
  const { t } = useTranslation();
  const { stageLabel } = useLeadLabels(config);
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("crm.activity_empty")}</p>;
  }

  const describe = (a: Activity): string => {
    const d = a.data;
    switch (a.kind) {
      case "created":
        return t("crm.activity_created", { stage: stageLabel(d.stage ?? "") });
      case "stage_changed":
        return t("crm.activity_moved", {
          from: stageLabel(d.from ?? ""),
          to: stageLabel(d.to ?? ""),
        });
      case "follow_up_set":
        return t("crm.activity_follow_up", { date: d.date ? formatDate(d.date) : "" });
      case "converted":
        return t("crm.activity_converted", { name: d.name ?? "" });
      case "quote_linked":
        return d.quote_id === lead.quote_id && lead.quote_number
          ? t("crm.activity_quote", { number: lead.quote_number })
          : t("crm.activity_quote_any");
      case "project_created":
        return t("crm.activity_project", { name: d.name ?? "" });
    }
  };

  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {items.map((a) => {
        const Icon = ACTIVITY_ICONS[a.kind] ?? Plus;
        // Moved by an automation (or a follow-up an arrival action set).
        const automatic = !!a.data.event || !!a.data.automatic;
        return (
          <li key={a.id} className="relative">
            <span className="absolute -left-[1.85rem] flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground">
              <Icon className="h-3 w-3" />
            </span>
            <p className="text-sm">{describe(a)}</p>
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span>{when(a.created_at)}</span>
              {automatic ? (
                <span className="inline-flex items-center gap-1">
                  · <Zap className="h-3 w-3 fill-amber-400 text-amber-500" />
                  {a.data.event ? t(`crm.event_${a.data.event}`) : t("crm.activity_automatic")}
                </span>
              ) : (
                a.user_name && <span>· {a.user_name}</span>
              )}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
