import { Activity, Database, Gauge, Server, Workflow } from "lucide-react";

const links = [
  { key: "runs", href: "/#runs", label: "Runs", icon: Activity },
  { key: "workflows", href: "/#workflows", label: "Workflows", icon: Workflow },
  { key: "benchmark-lab", href: "/#benchmark-lab", label: "Benchmark Lab", icon: Gauge },
  { key: "artifacts", href: "/#artifacts", label: "Artifacts", icon: Database },
  { key: "diagnostics", href: "/#diagnostics", label: "Diagnostics", icon: Server },
];

export function AppSidebar({ active = "runs" }: { active?: string }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">OS</div>
        <div>
          <strong>Open Superforecaster</strong>
          <span>Local research appliance</span>
        </div>
      </div>
      <nav>
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <a className={active === link.key ? "active" : undefined} href={link.href} key={link.key}>
              <Icon size={16} />
              {link.label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
