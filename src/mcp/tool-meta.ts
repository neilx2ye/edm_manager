/** MCP 工具的前端展示元数据（不依赖 Node/SDK，可安全导入客户端组件）。 */
export const MCP_TOOL_META = [
  {
    name: "edm_get_context",
    label: "查看当前身份",
    description: "返回 API key 所属项目、key 信息与 MCP 服务地址。",
  },
  {
    name: "edm_list_topics",
    label: "列出主题",
    description: "发现项目下的主题（topic）。",
  },
  {
    name: "edm_list_templates",
    label: "列出模板",
    description: "按主题、标签、状态、关键词筛选模板。",
  },
  {
    name: "edm_list_versions",
    label: "版本历史",
    description: "读取模板版本列表及 lint / 截图任务状态。",
  },
  {
    name: "edm_get_version",
    label: "版本详情",
    description: "读取单个版本的完整 HTML 与元数据。",
  },
  {
    name: "edm_push_version",
    label: "推送版本",
    description: "提交 draft 实时预览，或 saved 直接采纳。",
  },
  {
    name: "edm_approve_version",
    label: "采纳版本",
    description: "把 draft 版本标记为 saved（受项目开关约束）。",
  },
  {
    name: "edm_get_version_screenshot",
    label: "读取截图",
    description: "获取 desktop / mobile 渲染截图。",
  },
  {
    name: "edm_list_images",
    label: "图片列表",
    description: "列出项目图片库与可引用 URL。",
  },
  {
    name: "edm_upload_image",
    label: "上传图片",
    description: "上传 base64 图片；stdio 模式支持本地路径。",
  },
  {
    name: "edm_get_image",
    label: "读取图片",
    description: "按 image_id 返回图片原图。",
  },
  {
    name: "edm_delete_image",
    label: "删除图片",
    description: "删除本 key 上传的图片。",
  },
] as const;
