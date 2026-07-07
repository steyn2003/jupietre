import type { Icon } from "@phosphor-icons/react";
import {
  BookOpenIcon,
  BroadcastIcon,
  ChartLineUpIcon,
  ChatCircleDotsIcon,
  ClockIcon,
  FlowArrowIcon,
  GitBranchIcon,
  GraphIcon,
  KanbanIcon,
  LightbulbIcon,
  ListChecksIcon,
  PlayIcon,
  PlugsConnectedIcon,
  RobotIcon,
  StorefrontIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";

/**
 * Single source of truth for the app's information architecture. The desktop
 * Sidebar renders TOP_LEVEL + GROUPS verbatim; the mobile tab bar promotes
 * Agents next to the three top-level items and folds everything else into
 * the menu sheet (SHEET_GROUPS).
 */

export type NavItem = {
  href: string;
  label: string;
  icon: Icon;
  /** Prefix that keeps the item highlighted on subroutes (defaults to href). */
  matchPrefix?: string;
};

export type NavGroup = { label: string; items: NavItem[] };

const AGENTS: NavItem = { href: "/agents", label: "Agents", icon: RobotIcon };

export const TOP_LEVEL: NavItem[] = [
  { href: "/", label: "Control", icon: GraphIcon },
  { href: "/work", label: "Work", icon: ListChecksIcon },
  { href: "/sessions", label: "Sessions", icon: ChatCircleDotsIcon, matchPrefix: "/sessions" },
];

export const GROUPS: NavGroup[] = [
  {
    label: "Build",
    items: [
      AGENTS,
      { href: "/skills", label: "Skills", icon: BookOpenIcon },
      { href: "/market", label: "Market", icon: StorefrontIcon },
      { href: "/improvements", label: "Improvements", icon: LightbulbIcon },
    ],
  },
  {
    label: "Automate",
    items: [
      { href: "/workflows", label: "Workflows", icon: FlowArrowIcon },
      { href: "/workflow-runs", label: "Runs", icon: PlayIcon },
      { href: "/pollers", label: "Pollers", icon: KanbanIcon },
      { href: "/schedules", label: "Schedules", icon: ClockIcon },
      { href: "/events", label: "Events", icon: BroadcastIcon },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/repos", label: "Repos", icon: GitBranchIcon },
      { href: "/connections", label: "Connections", icon: PlugsConnectedIcon },
      { href: "/usage", label: "Usage", icon: ChartLineUpIcon },
      { href: "/settings/team", label: "Team", icon: UsersThreeIcon, matchPrefix: "/settings" },
    ],
  },
];

/** The four destination tabs on mobile; the fifth tab is the menu sheet. */
export const MOBILE_TABS: NavItem[] = [...TOP_LEVEL, AGENTS];

/** Everything only reachable through the mobile menu sheet. */
export const SHEET_GROUPS: NavGroup[] = GROUPS.map((group) => ({
  label: group.label,
  items: group.items.filter((item) => item.href !== AGENTS.href),
})).filter((group) => group.items.length > 0);

/**
 * Segment-aware active check: `/work` matches `/work` and `/work/123` but
 * not `/workflows`. Root only matches exactly.
 */
export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  if (pathname === item.href) return true;
  const prefix = item.matchPrefix ?? item.href;
  return pathname === prefix || pathname.startsWith(prefix + "/");
}
