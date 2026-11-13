// Leads page: a list view (stage tabs, table sorted by next follow-up) or a
// board view (one column per stage, drag a card to change its stage), with
// search, a date filter and a dialog to add or edit a lead. A lead can become
// a customer and a quote in one click; once it has a quote, its card opens it.
// Admins set each stage's automations from the ⚡ button on its column.

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  Download,
  FilePlus,
  FileText,
  Kanban,
  List,
  Pencil,
  Plus,
  Search,
  Target,
  Trash2,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { DateRangeFilter } from "@/components/shared/DateRangeFilter";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Hint, TooltipProvider } from "@/components/ui/tooltip";
import { useCan } from "@/hooks/use-can";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import { useSettingsStore } from "@/stores/settings.store";
import { type CrmConfig, crmApi, isClosed, type Lead } from "./api";
import {
  automationCount,
  stageStyle,
  useCrmConfig,
  useCrmTranslation,
  useLeadLabels,
} from "./config";
import { LeadDialog } from "./LeadDialog";
import { LeadTypeIcon } from "./LeadTypeIcon";
import { StageAutomationsDialog } from "./StageAutomations";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CrmPage() {
  const { t } = useCrmTranslation();
  const navigate = useNavigate();
  const can = useCan();
  const canCreate = can("customers", "create");
  const canEdit = can("customers", "update");
  const canDelete = can("customers", "delete");
  const canQuote = canCreate && can("invoices", "create");
  const settings = useSettingsStore((s) => s.settings);
  const currency = settings.base_currency || settings.currency || "USD";
  const { config, setConfig } = useCrmConfig();
  const { stageLabel, sourceLabel } = useLeadLabels(config);
  const isAdmin = useAuthStore((s) => !!s.user?.is_admin);
  const [automating, setAutomating] = useState<string | null>(null);

  const [view, setView] = usePersistentState<"list" | "board">("inkvoice-crm-view", "list");
  const [stage, setStage] = useState<string>("all");
  // The board shows every stage as a column, so the stage tab does not apply.
  const stageFilter = view === "board" || stage === "all" ? undefined : stage;
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState<{ from?: string; to?: string }>({});
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Lead | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const filters = {
    stage: stageFilter,
    search: search || undefined,
    from: dateRange.from,
    to: dateRange.to,
  };

  const fetchLeads = useCallback(async () => {
    try {
      const res = await crmApi.list({
        stage: stageFilter,
        search: search || undefined,
        from: dateRange.from,
        to: dateRange.to,
      });
      setLeads(res.data.items);
      setCounts(res.data.counts);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [stageFilter, search, dateRange]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const today = todayIso();
  const isDue = (l: Lead) => !!l.next_follow_up && !isClosed(l.stage) && l.next_follow_up <= today;
  const dueCount = leads.filter(isDue).length;
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  // Stages in the saved order. A hidden stage still shows while leads are in it.
  const stages = config.stages.filter((s) => !s.hidden || (counts[s.id] ?? 0) > 0).map((s) => s.id);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  // Clicking a lead opens its own page; the pencil still edits it in place.
  const openLead = (lead: Lead) => navigate(`/crm/leads/${lead.id}`);
  const openEdit = (lead: Lead) => {
    setEditing(lead);
    setDialogOpen(true);
  };

  const changeStage = async (lead: Lead, next: string) => {
    // Move it straight away so a dragged card does not jump back while saving.
    // The stage's arrival actions (follow-up date, …) run on the server.
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, stage: next } : l)));
    try {
      await crmApi.update(lead.id, { stage: next });
      fetchLeads();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const convert = async (lead: Lead) => {
    try {
      await crmApi.convert(lead.id);
      toast.success(t("crm.converted"));
      fetchLeads();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const createQuote = async (lead: Lead) => {
    try {
      const res = await crmApi.startQuote(lead.id);
      navigate(`/quotes/new?customer_id=${res.data.customer_id}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveAutomations = async (next: CrmConfig) => {
    try {
      const res = await crmApi.saveSettings(next);
      setConfig(res.data);
      toast.success(t("crm.settings_saved"));
      fetchLeads();
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await crmApi.remove(deleteId);
      toast.success(t("crm.deleted"));
      fetchLeads();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleteId(null);
    }
  };

  const renderActions = (l: Lead, compact = false) => {
    const action = (label: string, Icon: typeof FileText, onClick: () => void) => (
      <Hint label={label}>
        <Button
          variant="ghost"
          size={compact ? "icon-xs" : "icon"}
          aria-label={label}
          onClick={onClick}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </Hint>
    );
    return (
      <>
        {l.quote_id && l.quote_number
          ? // It already has a quote, so open that rather than starting another.
            action(t("crm.open_quote", { number: l.quote_number }), FileText, () =>
              navigate(`/quotes/${l.quote_id}`),
            )
          : canQuote &&
            !isClosed(l.stage) &&
            action(t("crm.create_quote"), FilePlus, () => createQuote(l))}
        {l.customer_id
          ? action(t("crm.view_customer"), Users, () => navigate(`/customers/${l.customer_id}`))
          : canCreate &&
            // A lost lead isn't worth turning into a customer; Won still can be.
            l.stage !== "lost" &&
            action(t("crm.convert"), UserPlus, () => convert(l))}
        {canEdit && action(t("common.edit"), Pencil, () => openEdit(l))}
        {canDelete && action(t("common.delete"), Trash2, () => setDeleteId(l.id))}
      </>
    );
  };

  const followUp = (l: Lead) =>
    l.next_follow_up ? (
      <span className={cn(isDue(l) && "font-medium text-destructive")}>
        {l.next_follow_up === today ? t("crm.today") : formatDate(l.next_follow_up)}
        {isDue(l) && l.next_follow_up < today && ` · ${t("crm.overdue")}`}
      </span>
    ) : null;
  const quoteChip = (l: Lead) =>
    l.quote_number ? (
      <span className="text-xs text-muted-foreground">
        {l.quote_number}
        {l.quote_status && ` · ${t(`quotes.status_${l.quote_status}`)}`}
      </span>
    ) : null;
  const colCount = 7;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{t("crm.title")}</h1>
            {dueCount > 0 && (
              <Badge variant="destructive">{t("crm.follow_ups_due", { count: dueCount })}</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
            {can("customers", "export") && (
              <Button
                variant="outline"
                onClick={() => window.open(crmApi.exportUrl(filters), "_blank")}
              >
                <Download className="h-4 w-4 mr-2" /> {t("common.export_csv")}
              </Button>
            )}
            <div className="inline-flex h-8 items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
              {(
                [
                  ["list", List, t("crm.view_list")],
                  ["board", Kanban, t("crm.view_board")],
                ] as const
              ).map(([value, Icon, label]) => (
                <Hint key={value} label={label}>
                  <Button
                    variant={view === value ? "secondary" : "ghost"}
                    className="h-full w-8 px-0"
                    aria-label={label}
                    aria-pressed={view === value}
                    onClick={() => setView(value)}
                  >
                    <Icon />
                  </Button>
                </Hint>
              ))}
            </div>
            {canCreate && (
              <Button onClick={openNew}>
                <Plus className="h-4 w-4 mr-2" /> {t("crm.add_lead")}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {view === "list" && (
            <Tabs value={stage} onValueChange={(v) => setStage(v as string)}>
              <TabsList>
                <TabsTrigger value="all">
                  {t("crm.tab_all")} <span className="ml-1 text-muted-foreground">{total}</span>
                </TabsTrigger>
                {stages.map((s) => (
                  <TabsTrigger key={s} value={s}>
                    {stageLabel(s)}
                    <span className="ml-1 text-muted-foreground">{counts[s] ?? 0}</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("crm.search_placeholder")}
              aria-label={t("common.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {view === "board" ? (
          <LeadBoard
            leads={leads}
            stages={stages}
            canEdit={canEdit}
            currency={currency}
            stageLabel={stageLabel}
            stageStyle={(id) => stageStyle(config, id)}
            automations={(id) => {
              const s = config.stages.find((x) => x.id === id);
              return s ? automationCount(config, s) : 0;
            }}
            onAutomate={isAdmin ? setAutomating : undefined}
            quoteChip={quoteChip}
            followUp={followUp}
            renderActions={renderActions}
            onOpen={openLead}
            onMove={changeStage}
          />
        ) : (
          <div className="glass-table-wrapper">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableCell className="font-medium text-sm">{t("crm.col_name")}</TableCell>
                  <TableCell className="font-medium text-sm">{t("crm.col_contact")}</TableCell>
                  <TableCell className="font-medium text-sm">{t("crm.col_source")}</TableCell>
                  <TableCell className="font-medium text-sm text-right">
                    {t("crm.col_value")}
                  </TableCell>
                  <TableCell className="font-medium text-sm">{t("crm.col_stage")}</TableCell>
                  <TableCell className="font-medium text-sm">{t("crm.col_follow_up")}</TableCell>
                  <TableCell className="w-[160px] font-medium text-sm text-muted-foreground">
                    {t("common.actions")}
                  </TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colCount} className="p-0">
                      <EmptyState
                        icon={Target}
                        title={t("crm.empty_title")}
                        description={t("crm.empty_description")}
                        actionLabel={t("crm.add_lead")}
                        onAction={canCreate ? openNew : undefined}
                      />
                    </TableCell>
                  </TableRow>
                )}
                {leads.map((l) => (
                  <TableRow
                    key={l.id}
                    className={cn(
                      "transition-colors",
                      "cursor-pointer hover:bg-accent/50",
                      l.stage === "lost" && "opacity-60",
                    )}
                    onClick={() => openLead(l)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-1.5 font-medium">
                        <LeadTypeIcon type={l.lead_type} />
                        {l.name}
                      </div>
                      {l.company && (
                        <div className="text-xs text-muted-foreground">{l.company}</div>
                      )}
                      {quoteChip(l)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div>{l.email || "-"}</div>
                      {l.phone && <div className="text-xs">{l.phone}</div>}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {l.source ? sourceLabel(l.source) : "-"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.value != null ? formatCurrency(l.value, currency) : "-"}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canEdit ? (
                        <Select
                          value={l.stage}
                          onValueChange={(v) => v && v !== l.stage && changeStage(l, v)}
                        >
                          <SelectTrigger
                            className={cn(
                              "border-transparent font-medium",
                              stageStyle(config, l.stage),
                            )}
                            aria-label={t("crm.col_stage")}
                          >
                            <SelectValue>{stageLabel(l.stage)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {stages.map((s) => (
                              <SelectItem key={s} value={s}>
                                {stageLabel(s)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge className={stageStyle(config, l.stage)}>{stageLabel(l.stage)}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {followUp(l) ?? <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">{renderActions(l)}</div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <LeadDialog
          open={dialogOpen}
          lead={editing}
          config={config}
          stages={stages}
          onOpenChange={setDialogOpen}
          onSaved={fetchLeads}
        />

        <StageAutomationsDialog
          open={automating !== null}
          onOpenChange={(o) => !o && setAutomating(null)}
          config={config}
          stageId={automating}
          onApply={saveAutomations}
        />

        <ConfirmDialog
          open={deleteId !== null}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title={t("crm.delete_title")}
          description={t("crm.delete_description")}
          confirmLabel={t("common.delete")}
          variant="destructive"
          onConfirm={handleDelete}
        />
      </div>
    </TooltipProvider>
  );
}

function LeadBoard({
  leads,
  stages,
  canEdit,
  currency,
  stageLabel,
  stageStyle,
  automations,
  onAutomate,
  quoteChip,
  followUp,
  renderActions,
  onOpen,
  onMove,
}: {
  leads: Lead[];
  stages: string[];
  canEdit: boolean;
  currency: string;
  stageLabel: (s: string) => string;
  stageStyle: (s: string) => string;
  automations: (s: string) => number;
  /** Admins only: open the stage's automations. */
  onAutomate?: (s: string) => void;
  quoteChip: (l: Lead) => ReactNode;
  followUp: (l: Lead) => ReactNode;
  renderActions: (l: Lead, compact?: boolean) => ReactNode;
  onOpen: (l: Lead) => void;
  onMove: (l: Lead, stage: string) => void;
}) {
  // A small drag distance keeps a plain click opening the lead.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const lead = leads.find((l) => l.id === active.id);
    const target = over?.id as string | undefined;
    if (lead && target && target !== lead.stage) onMove(lead, target);
  };

  const height = useFillHeight<HTMLDivElement>();
  // The card being dragged is drawn in an overlay, so it isn't clipped by its
  // column's scroll area while it moves to another column.
  const [dragging, setDragging] = useState<Lead | null>(null);

  const cardBody = (l: Lead) => (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium">
            <LeadTypeIcon type={l.lead_type} />
            <span className="truncate">{l.name}</span>
          </div>
          {l.company && <div className="text-xs text-muted-foreground truncate">{l.company}</div>}
          {quoteChip(l)}
        </div>
        {l.value != null && (
          <div className="text-sm tabular-nums shrink-0">{formatCurrency(l.value, currency)}</div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <div className="text-muted-foreground">{followUp(l)}</div>
        <div
          className="flex gap-0.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {renderActions(l, true)}
        </div>
      </div>
    </>
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setDragging(leads.find((l) => l.id === active.id) ?? null)}
      onDragEnd={(e) => {
        setDragging(null);
        handleDragEnd(e);
      }}
      onDragCancel={() => setDragging(null)}
    >
      {/* Fills the window below the toolbar; each column scrolls on its own. */}
      <div
        ref={height.ref}
        style={{ height: height.value }}
        className="grid min-h-[24rem] grid-flow-col auto-cols-[minmax(15rem,1fr)] gap-3 overflow-x-auto pb-2"
      >
        {stages.map((stage) => {
          const items = leads.filter((l) => l.stage === stage);
          const sum = items.reduce((a, l) => a + (l.value ?? 0), 0);
          return (
            <BoardColumn
              key={stage}
              stage={stage}
              title={stageLabel(stage)}
              style={stageStyle(stage)}
              count={items.length}
              total={sum > 0 ? formatCurrency(sum, currency) : null}
              automations={automations(stage)}
              onAutomate={onAutomate && (() => onAutomate(stage))}
            >
              {items.map((l) => (
                <BoardCard key={l.id} lead={l} draggable={canEdit} onOpen={() => onOpen(l)}>
                  {cardBody(l)}
                </BoardCard>
              ))}
            </BoardColumn>
          );
        })}
      </div>
      <DragOverlay>
        {dragging && (
          <div className="cursor-grabbing rounded-lg border border-border bg-background p-3 text-sm shadow-lg">
            {cardBody(dragging)}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function BoardColumn({
  stage,
  title,
  style,
  count,
  total,
  automations,
  onAutomate,
  children,
}: {
  stage: string;
  title: string;
  style: string;
  count: number;
  total: string | null;
  automations: number;
  onAutomate?: () => void;
  children: ReactNode;
}) {
  const { t } = useCrmTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-0 flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2 transition-colors",
        isOver && "border-primary/50 bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1 py-1">
        <span className={cn("truncate rounded-md px-2 py-0.5 text-xs font-medium", style)}>
          {title} <span className="opacity-70">{count}</span>
        </span>
        <div className="flex items-center gap-1">
          {total && <span className="text-xs text-muted-foreground tabular-nums">{total}</span>}
          {onAutomate && (
            <Hint
              label={
                automations > 0
                  ? t("crm.automations_count", { count: String(automations) })
                  : t("crm.automations_set")
              }
            >
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onAutomate}
                aria-label={`${t("crm.automations")}: ${title}`}
              >
                <Zap className={cn(automations > 0 && "fill-amber-400 text-amber-500")} />
              </Button>
            </Hint>
          )}
        </div>
      </div>
      <div className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-1">{children}</div>
    </div>
  );
}

/** Space kept below the board: a small gap plus the main area's own bottom padding. */
const PAGE_BOTTOM_GAP = 32;

/**
 * Height from the element's top edge to the bottom of the window, so the
 * board always fills the screen. Measured again on resize and when content
 * above it (toolbar wrapping, banners) moves it.
 */
function useFillHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [value, setValue] = useState<number>();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const top = el.getBoundingClientRect().top + (el.closest("main")?.scrollTop ?? 0);
      setValue(Math.max(0, Math.floor(window.innerHeight - top - PAGE_BOTTOM_GAP)));
    };
    measure();
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    if (el.parentElement) observer.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);
  return { ref, value };
}

function BoardCard({
  lead,
  draggable,
  onOpen,
  children,
}: {
  lead: Lead;
  draggable: boolean;
  onOpen: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    disabled: !draggable,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={cn(
        "rounded-lg border border-border bg-background p-3 text-sm shadow-xs",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        // The overlay shows the moving card; this one marks where it came from.
        isDragging && "opacity-40",
        lead.stage === "lost" && "opacity-60",
      )}
    >
      {children}
    </div>
  );
}
