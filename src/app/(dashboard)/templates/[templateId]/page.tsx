import TemplateDetail from "./detail";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  const { templateId } = await params;
  return <TemplateDetail templateId={Number(templateId)} />;
}
