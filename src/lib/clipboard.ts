/** 剪贴板粘贴图片相关工具。 */

/**
 * 从剪贴板数据里取出图片文件。
 * 剪贴板里没有图片时返回 null，调用方应按普通文本粘贴处理（不要拦截）。
 */
export function imageFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data?.items?.length) return null;
  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i];
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file && file.size > 0) return file;
    }
  }
  return null;
}

const ESCAPE_ATTR: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

/** 生成可插入邮件 HTML 的 <img> 标签，转义 alt 文本。 */
export function imageTag(url: string, name: string): string {
  const alt = name.replace(/[&<>"]/g, (c) => ESCAPE_ATTR[c]);
  return `<img src="${url}" alt="${alt}" />`;
}
