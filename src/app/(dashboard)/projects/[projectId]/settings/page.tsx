import ProjectSettings from "./settings";

const TABS = ["general", "topics", "apikeys", "mcp"] as const;
type Tab = (typeof TABS)[number];

export default async function ProjectSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { projectId } = await params;
  const { tab } = await searchParams;
  // 支持 ?tab= 深链，非法或缺省回退 general
  const initialTab: Tab = (TABS as readonly string[]).includes(tab ?? "")
    ? (tab as Tab)
    : "general";
  return <ProjectSettings projectId={Number(projectId)} initialTab={initialTab} />;
}
