// CRM frontend registration: a protected route (guarded by PluginGuard), a
// sidebar item under Plugins, its i18n, and its entry in the admin Plugins tab.

import { Target } from "lucide-react";
import { registerNavItem } from "@/nav-registry";
import { PluginGuard } from "@/plugins/PluginGuard";
import { registerPlugin } from "@/plugins/registry";
import { registerRoute } from "@/route-registry";
import "./i18n";
import CrmPage from "./CrmPage";
import CrmSettings from "./CrmSettings";

const PLUGIN_ID = "crm";

registerRoute({
  path: "/crm",
  element: (
    <PluginGuard pluginId={PLUGIN_ID}>
      <CrmPage />
    </PluginGuard>
  ),
  scope: "protected",
});

registerNavItem({
  to: "/crm",
  labelKey: "crm.nav",
  icon: Target,
  section: "nav.plugins",
  pluginId: PLUGIN_ID,
});

registerPlugin({
  id: PLUGIN_ID,
  nameKey: "crm.name",
  descriptionKey: "crm.description",
  icon: Target,
  settings: CrmSettings,
});
