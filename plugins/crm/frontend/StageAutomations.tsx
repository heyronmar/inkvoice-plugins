// One stage's automations, opened from the ⚡ button on a board column or a
// stage row in CRM settings. Only what fits the stage's place is offered:
//  - the first stage is where new leads start, so nothing moves leads in;
//  - other stages pick one event, and only events in pipeline order (after
//    earlier stages' events, before later ones') are listed;
//  - Won takes the deal going ahead, Lost a declined quote;
//  - arrival actions: a follow-up while the lead is being worked on, a
//    customer once past the first stage, a project once won.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from "@/components/ui/switch";
import { useTranslation } from "@/i18n";
import { usePluginsStore } from "@/plugins/use-plugins.store";
import type { CrmConfig, LeadEvent, StageActions } from "./api";
import { eventsFor, stageRole, stageTrigger, useLeadLabels } from "./config";

const MANUAL = "manual";

export function StageAutomationsDialog({
  open,
  onOpenChange,
  config,
  stageId,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: CrmConfig;
  stageId: string | null;
  /** Receives the whole config with this stage's rules changed. */
  onApply: (config: CrmConfig) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const { stageLabel } = useLeadLabels(config);
  const timeTrackingOn = usePluginsStore((s) => s.isEnabled("time-tracker"));
  const [draft, setDraft] = useState(config);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(config);
  }, [open, config]);

  const stage = draft.stages.find((s) => s.id === stageId);
  if (!stage || !stageId) return null;
  const name = stageLabel(stageId);
  const role = stageRole(draft, stageId);
  const trigger = stageTrigger(draft, stageId);
  const events = eventsFor(draft, stageId);
  const firstStage = draft.stages.find((s) => stageRole(draft, s.id) === "first");

  const setTrigger = (value: string) =>
    setDraft((d) => {
      // One rule per stage: drop this stage's old event, then add the new one.
      const triggers = Object.fromEntries(
        Object.entries(d.triggers).filter(([, s]) => s !== stageId),
      ) as CrmConfig["triggers"];
      if (value !== MANUAL) triggers[value as LeadEvent] = stageId;
      return { ...d, triggers };
    });

  const setAction = (patch: Partial<StageActions>) =>
    setDraft((d) => ({
      ...d,
      stages: d.stages.map((s) =>
        s.id === stageId ? { ...s, actions: { ...s.actions, ...patch } } : s,
      ),
    }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const apply = async () => {
    setSaving(true);
    try {
      await onApply(draft);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const followUp = (
    <div className="flex items-start gap-3">
      <Switch
        id="action-follow-up"
        className="mt-0.5"
        checked={stage.actions.follow_up_days !== null}
        onCheckedChange={(v) => setAction({ follow_up_days: v ? 3 : null })}
      />
      <div className="space-y-2">
        <Label htmlFor="action-follow-up">{t("crm.action_follow_up")}</Label>
        {stage.actions.follow_up_days !== null && (
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              max={365}
              className="w-20"
              aria-label={t("crm.settings_follow_up_days")}
              value={stage.actions.follow_up_days}
              onChange={(e) =>
                setAction({
                  follow_up_days: Math.min(365, Math.max(1, Number(e.target.value) || 1)),
                })
              }
            />
            <span className="text-sm text-muted-foreground">
              {t("crm.settings_follow_up_days")}
            </span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("crm.action_follow_up_hint")}</p>
      </div>
    </div>
  );

  const makeCustomer = (
    <ActionSwitch
      id="action-customer"
      checked={stage.actions.make_customer}
      onChange={(v) => setAction({ make_customer: v })}
      label={t("crm.action_make_customer")}
      hint={t("crm.action_make_customer_hint")}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Only the middle scrolls, so the title and Save stay in view. */}
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("crm.auto_title", { stage: name })}</DialogTitle>
          <DialogDescription>{t(`crm.auto_role_${role}`)}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          <div className="grid gap-6 md:grid-cols-2">
            <section className="space-y-3">
              <h3 className="text-sm font-medium">{t("crm.auto_move_here", { stage: name })}</h3>
              {role === "first" ? (
                <p className="text-sm text-muted-foreground">
                  {t("crm.auto_first_stage", { stage: name })}
                </p>
              ) : events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("crm.auto_no_events")}</p>
              ) : (
                <>
                  <Select value={trigger ?? MANUAL} onValueChange={(v) => v && setTrigger(v)}>
                    <SelectTrigger
                      className="w-full"
                      aria-label={t("crm.auto_move_here", { stage: name })}
                    >
                      <SelectValue>
                        {trigger ? t(`crm.event_${trigger}`) : t("crm.auto_manual")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MANUAL}>{t("crm.auto_manual")}</SelectItem>
                      {events.map((e) => (
                        <SelectItem key={e} value={e}>
                          {t(`crm.event_${e}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {trigger
                      ? t(`crm.event_${trigger}_hint`)
                      : t("crm.auto_manual_hint", {
                          stage: firstStage ? stageLabel(firstStage.id) : "",
                        })}
                  </p>
                </>
              )}
            </section>

            <section className="space-y-3 border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
              <h3 className="text-sm font-medium">{t("crm.auto_on_arrival", { stage: name })}</h3>
              {role === "lost" && (
                <p className="text-sm text-muted-foreground">{t("crm.auto_lost_no_actions")}</p>
              )}
              {role === "first" && followUp}
              {role === "middle" && (
                <>
                  {makeCustomer}
                  {followUp}
                </>
              )}
              {role === "won" && (
                <>
                  {makeCustomer}
                  <ActionSwitch
                    id="action-project"
                    checked={stage.actions.create_project}
                    onChange={(v) => setAction({ create_project: v })}
                    label={t("crm.action_create_project")}
                    hint={`${t("crm.action_create_project_hint")}${
                      timeTrackingOn ? "" : ` ${t("crm.auto_needs_time_tracking")}`
                    }`}
                  />
                </>
              )}
            </section>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={apply} disabled={!dirty || saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionSwitch({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} className="mt-0.5" checked={checked} onCheckedChange={onChange} />
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
