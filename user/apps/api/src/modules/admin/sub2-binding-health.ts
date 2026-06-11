export interface Sub2BindingHealthRecord {
  meta: unknown;
}

export function isLocalProxySmokeSub2Binding(binding: Sub2BindingHealthRecord) {
  const meta = jsonRecord(binding.meta);
  return meta?.smokeTest === true;
}

export function nonSmokeSub2Bindings<T extends Sub2BindingHealthRecord>(bindings: T[]) {
  return bindings.filter((binding) => !isLocalProxySmokeSub2Binding(binding));
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
