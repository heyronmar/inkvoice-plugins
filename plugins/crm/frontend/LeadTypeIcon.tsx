// Building for a company, person for an individual: the same icons the
// Customers list uses, so a lead reads the same before and after converting.

import { Building2, User } from "lucide-react";
import { useTranslation } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Lead } from "./api";

export function LeadTypeIcon({ type, className }: { type: Lead["lead_type"]; className?: string }) {
  const { t } = useTranslation();
  const Icon = type === "individual" ? User : Building2;
  const label = t(type === "individual" ? "customers.type_individual" : "customers.type_company");
  return (
    <Icon
      className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)}
      aria-label={label}
      role="img"
    >
      <title>{label}</title>
    </Icon>
  );
}
