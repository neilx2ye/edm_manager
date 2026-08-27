# 给 kimi code 的任务（第十二轮：统一「复制原代码」按钮样式）

## 要求

在 `src/app/(dashboard)/templates/[templateId]/detail.tsx` 的顶部工具条中，
「复制原代码」按钮当前使用 `${btnSecondary} disabled:opacity-50`，尺寸（py-2 /
text-sm）比同排其他按钮大，观感不统一。

请把它的 className 改为与同排「移动/复制」按钮完全一致的紧凑样式，并保留禁用态：

```tsx
className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
```

即：去掉对 `btnSecondary` 的引用，直接写上面的内联类。

## 保持不变

- 按钮功能逻辑完全不变：`disabled={!selected}`、点击 `copySelectedCode()`、
  文案在「复制原代码 / 已复制 / 复制失败」间切换（1.8 秒后复位）
- 其他按钮、面包屑、desktop/mobile 切换等一律不动

## 约束

- 禁止 `next dev` / `next build`；自查只 `npx tsc --noEmit`
- 不改后端与受保护文件

## 汇报

`npx tsc --noEmit` 零错误后，用中文简要汇报改动点。

现在开始。
