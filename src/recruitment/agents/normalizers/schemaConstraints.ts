export function isJsonSchemaObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Enforce Responses API JSON schema constraints: type object, required array, no additionalProperties.
 */
export function enforceResponsesJsonSchemaConstraints(schema: unknown): void {
  const visited = new WeakSet<object>();

  const walk = (node: unknown): void => {
    if (!isJsonSchemaObject(node)) return;
    if (visited.has(node)) return;
    visited.add(node);

    const properties = isJsonSchemaObject(node.properties) ? (node.properties as Record<string, unknown>) : null;
    const additionalProps = node.additionalProperties;
    const isRecordType =
      node.type === 'object' &&
      (!properties || Object.keys(properties).length === 0) &&
      isJsonSchemaObject(additionalProps) &&
      'type' in additionalProps;
    if (properties && Object.keys(properties).length > 0) {
      node.type = 'object';
      const propertyNames = Object.keys(properties);
      const required = Array.isArray(node.required) ? node.required.filter((v): v is string => typeof v === 'string') : [];
      const requiredSet = new Set(required);
      for (const propertyName of propertyNames) {
        if (!requiredSet.has(propertyName)) {
          required.push(propertyName);
          requiredSet.add(propertyName);
        }
      }
      node.required = required;
      node.additionalProperties = false;
      for (const propertyName of propertyNames) {
        walk(properties[propertyName]);
      }
    } else if (node.type === 'object' && !isRecordType) {
      node.additionalProperties = false;
    } else if (isRecordType && isJsonSchemaObject(additionalProps)) {
      walk(additionalProps);
    }

    if (isJsonSchemaObject(node.items) || Array.isArray(node.items)) {
      walk(node.items);
    }
    if (Array.isArray(node.anyOf)) {
      for (const branch of node.anyOf) walk(branch);
    }
    if (Array.isArray(node.oneOf)) {
      for (const branch of node.oneOf) walk(branch);
    }
    if (Array.isArray(node.allOf)) {
      for (const branch of node.allOf) walk(branch);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' || key === 'items' || key === 'anyOf' || key === 'oneOf' || key === 'allOf') continue;
      if (isJsonSchemaObject(value) || Array.isArray(value)) {
        walk(value);
      }
    }
  };

  walk(schema);
}
