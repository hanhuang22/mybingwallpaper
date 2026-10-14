interface TextMenuTarget {
  tagName: string;
  inputType?: string | null;
  disabled?: boolean;
  contentEditable?: boolean;
}

const textInputTypes = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

export function allowsNativeTextMenu(target: TextMenuTarget | null): boolean {
  if (!target || target.disabled) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") return textInputTypes.has((target.inputType || "text").toLowerCase());
  return Boolean(target.contentEditable);
}

export function preventBrowserContextMenu(event: Event): void {
  const target = event.target instanceof Element ? event.target : null;
  const field = target?.closest("input, textarea, [contenteditable]");
  const allow = allowsNativeTextMenu(field ? {
    tagName: field.tagName,
    inputType: field.getAttribute("type"),
    disabled: field.matches(":disabled"),
    contentEditable: field instanceof HTMLElement && field.isContentEditable,
  } : null);
  // Keep native text editing and leave propagation intact for app-owned menus.
  if (!allow) event.preventDefault();
}
